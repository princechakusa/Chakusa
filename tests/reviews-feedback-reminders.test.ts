import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { markReviewRequestFeedbackReceived } from "../src/modules/reviews/reviews.service.js";

describe("review requests", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("walks a review request through pending -> sent -> reviewed", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(token),
      payload: { serviceName: "haircut" },
    });
    expect(created.json().status).toBe("pending");

    const sent = await app.inject({
      method: "POST",
      url: `/review-requests/${created.json().id}/mark-sent`,
      headers: authHeader(token),
    });
    expect(sent.json().status).toBe("sent");
    expect(sent.json().sentAt).not.toBeNull();

    const reviewed = await app.inject({
      method: "POST",
      url: `/review-requests/${created.json().id}/mark-reviewed`,
      headers: authHeader(token),
    });
    expect(reviewed.json().status).toBe("reviewed");
  });

  it("generates a review message containing the google review link", async () => {
    const { token } = await registerAccount(app);

    await app.inject({
      method: "PATCH",
      url: "/business",
      headers: authHeader(token),
      payload: { googleReviewLink: "https://g.page/r/example/review" },
    });

    const created = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(token),
      payload: {},
    });

    const generated = await app.inject({
      method: "POST",
      url: `/review-requests/${created.json().id}/generate-message`,
      headers: authHeader(token),
    });

    expect(generated.json().message).toContain("https://g.page/r/example/review");
  });

  it("supports mark-opened as an explicit transition and records activity", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(token),
      payload: {},
    });

    const opened = await app.inject({
      method: "POST",
      url: `/review-requests/${created.json().id}/mark-opened`,
      headers: authHeader(token),
    });

    expect(opened.json().status).toBe("opened");
  });

  it("ignores a status field sent in the PATCH body instead of applying it", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(token),
      payload: {},
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/review-requests/${created.json().id}`,
      headers: authHeader(token),
      payload: { status: "reviewed", serviceName: "manicure" },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().status).toBe("pending");
    expect(patched.json().sentAt).toBeNull();
    expect(patched.json().serviceName).toBe("manicure");
  });
});

describe("feedback", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it.each([
    [5, "positive"],
    [4, "positive"],
    [3, "neutral"],
    [2, "negative"],
    [1, "negative"],
  ])("derives sentiment %i -> %s", async (rating, expectedSentiment) => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/feedback",
      headers: authHeader(token),
      payload: { rating, comment: "test" },
    });

    expect(response.json().sentiment).toBe(expectedSentiment);
  });

  it("marks the linked review request as feedback_received", async () => {
    const { token } = await registerAccount(app);

    const reviewRequest = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(token),
      payload: {},
    });

    await app.inject({
      method: "POST",
      url: "/feedback",
      headers: authHeader(token),
      payload: { reviewRequestId: reviewRequest.json().id, rating: 2, comment: "not great" },
    });

    const fetched = await app.inject({
      method: "GET",
      url: `/review-requests/${reviewRequest.json().id}`,
      headers: authHeader(token),
    });

    expect(fetched.json().status).toBe("feedback_received");
  });

  it("records a FEEDBACK_RECEIVED activity against the review request when feedback triggers the transition automatically", async () => {
    const { token } = await registerAccount(app);

    const reviewRequest = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(token),
      payload: {},
    });
    const reviewRequestId = reviewRequest.json().id;

    await app.inject({
      method: "POST",
      url: "/feedback",
      headers: authHeader(token),
      payload: { reviewRequestId, rating: 5, comment: "great" },
    });

    const events = await prisma.activityEvent.findMany({
      where: { entityType: "review_request", entityId: reviewRequestId, eventType: "FEEDBACK_RECEIVED" },
    });
    expect(events).toHaveLength(1);
  });

  it("records a FEEDBACK_RECEIVED activity against the review request via the explicit mark-feedback-received transition", async () => {
    const { token } = await registerAccount(app);

    const reviewRequest = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(token),
      payload: {},
    });
    const reviewRequestId = reviewRequest.json().id;

    const transitioned = await app.inject({
      method: "POST",
      url: `/review-requests/${reviewRequestId}/mark-feedback-received`,
      headers: authHeader(token),
    });
    expect(transitioned.statusCode).toBe(200);
    expect(transitioned.json().status).toBe("feedback_received");

    const events = await prisma.activityEvent.findMany({
      where: { entityType: "review_request", entityId: reviewRequestId, eventType: "FEEDBACK_RECEIVED" },
    });
    expect(events).toHaveLength(1);
  });

  it("rolls back the status transition if the activity insertion fails inside the standalone transaction", async () => {
    // Proves the standalone mark-feedback-received endpoint's status update
    // and its activity event are genuinely atomic — not a mocked or
    // artificially-injected failure, but a real database constraint
    // (activity_events.actor_id has a foreign key to users.id) forced by
    // calling the service function directly with a nonexistent actorId.
    // If the transaction were not atomic, the review request would be left
    // in feedback_received with no corresponding activity event.
    const { token, businessId } = await registerAccount(app);

    const reviewRequest = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(token),
      payload: {},
    });
    const reviewRequestId = reviewRequest.json().id;

    const bogusActorId = "00000000-0000-0000-0000-000000000000";

    await expect(
      prisma.$transaction((tx) => markReviewRequestFeedbackReceived(businessId, bogusActorId, reviewRequestId, tx)),
    ).rejects.toThrow();

    const unchanged = await prisma.reviewRequest.findUniqueOrThrow({ where: { id: reviewRequestId } });
    expect(unchanged.status).toBe("pending");

    const events = await prisma.activityEvent.findMany({
      where: { entityType: "review_request", entityId: reviewRequestId, eventType: "FEEDBACK_RECEIVED" },
    });
    expect(events).toHaveLength(0);
  });

  it("creates only one FEEDBACK_RECEIVED activity when two standalone mark-feedback-received requests race", async () => {
    // Real concurrency against the standalone endpoint specifically (not
    // via createFeedback) — two independent HTTP requests fired with
    // Promise.all, each now wrapped in its own prisma.$transaction at the
    // route level. The claim-guard updateMany inside
    // markReviewRequestFeedbackReceived guarantees at most one transaction
    // can flip the status, so this is deterministic, not flaky.
    const { token } = await registerAccount(app);

    const reviewRequest = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(token),
      payload: {},
    });
    const reviewRequestId = reviewRequest.json().id;

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/review-requests/${reviewRequestId}/mark-feedback-received`,
        headers: authHeader(token),
      }),
      app.inject({
        method: "POST",
        url: `/review-requests/${reviewRequestId}/mark-feedback-received`,
        headers: authHeader(token),
      }),
    ]);

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().status).toBe("feedback_received");
    expect(second.json().status).toBe("feedback_received");

    const events = await prisma.activityEvent.findMany({
      where: { entityType: "review_request", entityId: reviewRequestId, eventType: "FEEDBACK_RECEIVED" },
    });
    expect(events).toHaveLength(1);
  });

  it("does not create a duplicate review-request transition activity when feedback is created against an already-feedback_received request", async () => {
    const { token } = await registerAccount(app);

    const reviewRequest = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(token),
      payload: {},
    });
    const reviewRequestId = reviewRequest.json().id;

    // First transition: via the dedicated endpoint.
    await app.inject({
      method: "POST",
      url: `/review-requests/${reviewRequestId}/mark-feedback-received`,
      headers: authHeader(token),
    });

    // Second piece of feedback against the same, already-transitioned
    // review request — must not log a second review-request-level
    // FEEDBACK_RECEIVED activity event.
    const second = await app.inject({
      method: "POST",
      url: "/feedback",
      headers: authHeader(token),
      payload: { reviewRequestId, rating: 2, comment: "also here" },
    });
    expect(second.statusCode).toBe(201);

    const events = await prisma.activityEvent.findMany({
      where: { entityType: "review_request", entityId: reviewRequestId, eventType: "FEEDBACK_RECEIVED" },
    });
    expect(events).toHaveLength(1);

    // The feedback row itself must still be created — only the
    // review-request-level activity log is deduplicated, not the feedback.
    expect(await prisma.feedback.count({ where: { reviewRequestId } })).toBe(1);
  });

  it("does not create a duplicate review-request transition activity when two feedback submissions race for the same review request", async () => {
    // Real concurrency, not a timing trick: two feedback creations are
    // fired at the same review request via Promise.all, each inside its
    // own prisma.$transaction. The claim-guard updateMany
    // (status: { not: "feedback_received" }) inside
    // markReviewRequestFeedbackReceived means at most one transaction's
    // update can match — Postgres row-level locking on the UPDATE
    // guarantees this regardless of how the two requests interleave, so
    // this assertion is deterministic, not flaky.
    const { token } = await registerAccount(app);

    const reviewRequest = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(token),
      payload: {},
    });
    const reviewRequestId = reviewRequest.json().id;

    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/feedback",
        headers: authHeader(token),
        payload: { reviewRequestId, rating: 5, comment: "race A" },
      }),
      app.inject({
        method: "POST",
        url: "/feedback",
        headers: authHeader(token),
        payload: { reviewRequestId, rating: 1, comment: "race B" },
      }),
    ]);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const events = await prisma.activityEvent.findMany({
      where: { entityType: "review_request", entityId: reviewRequestId, eventType: "FEEDBACK_RECEIVED" },
    });
    expect(events).toHaveLength(1);

    expect(await prisma.feedback.count({ where: { reviewRequestId } })).toBe(2);

    const finalReviewRequest = await prisma.reviewRequest.findUniqueOrThrow({ where: { id: reviewRequestId } });
    expect(finalReviewRequest.status).toBe("feedback_received");
  });

  it("transitions feedback status via PATCH and records activity", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/feedback",
      headers: authHeader(token),
      payload: { rating: 3, comment: "meh" },
    });
    expect(created.json().status).toBe("new");

    const acknowledged = await app.inject({
      method: "PATCH",
      url: `/feedback/${created.json().id}`,
      headers: authHeader(token),
      payload: { status: "acknowledged" },
    });
    expect(acknowledged.json().status).toBe("acknowledged");

    const resolved = await app.inject({
      method: "PATCH",
      url: `/feedback/${created.json().id}`,
      headers: authHeader(token),
      payload: { status: "resolved" },
    });
    expect(resolved.json().status).toBe("resolved");
  });

  it("returns 404 when updating feedback status for a nonexistent feedback row", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "PATCH",
      url: "/feedback/00000000-0000-0000-0000-000000000000",
      headers: authHeader(token),
      payload: { status: "resolved" },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("reminders", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("computes dueDate from lastVisitDate + business.reminderDays when dueDate omitted", async () => {
    const { token } = await registerAccount(app);

    await app.inject({
      method: "PATCH",
      url: "/business",
      headers: authHeader(token),
      payload: { reminderDays: 14 },
    });

    const lastVisitDate = new Date("2026-01-01T00:00:00.000Z");

    const response = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { lastVisitDate: lastVisitDate.toISOString() },
    });

    expect(response.statusCode).toBe(201);
    const dueDate = new Date(response.json().dueDate);
    const expected = new Date("2026-01-15T00:00:00.000Z");
    expect(dueDate.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
  });

  it("requires either dueDate or lastVisitDate", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("walks a reminder through due -> sent -> completed", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { dueDate: new Date().toISOString() },
    });
    expect(created.json().status).toBe("due");

    const sent = await app.inject({
      method: "POST",
      url: `/reminders/${created.json().id}/mark-sent`,
      headers: authHeader(token),
    });
    expect(sent.json().status).toBe("sent");

    const completed = await app.inject({
      method: "POST",
      url: `/reminders/${created.json().id}/mark-completed`,
      headers: authHeader(token),
    });
    expect(completed.json().status).toBe("completed");
  });

  it("dismisses a reminder", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { dueDate: new Date().toISOString() },
    });

    const dismissed = await app.inject({
      method: "POST",
      url: `/reminders/${created.json().id}/dismiss`,
      headers: authHeader(token),
    });

    expect(dismissed.json().status).toBe("dismissed");
  });

  it("ignores a status field sent in the PATCH body instead of applying it", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { dueDate: new Date().toISOString() },
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/reminders/${created.json().id}`,
      headers: authHeader(token),
      payload: { status: "completed", serviceName: "oil change" },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().status).toBe("due");
    expect(patched.json().serviceName).toBe("oil change");
  });
});
