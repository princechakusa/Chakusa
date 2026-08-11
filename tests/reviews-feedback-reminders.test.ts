import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

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
});
