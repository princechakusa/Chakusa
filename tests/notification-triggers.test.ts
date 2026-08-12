import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { createLead } from "../src/modules/leads/leads.service.js";
import { createFeedback } from "../src/modules/feedback/feedback.service.js";
import { createReviewRequest, markReviewRequestReviewed } from "../src/modules/reviews/reviews.service.js";
import type { PushMessage, PushProvider } from "../src/lib/push/pushProvider.js";

function makeCapturingProvider() {
  const calls: { tokens: string[]; message: PushMessage }[] = [];
  const provider: PushProvider = {
    isValidToken: () => true,
    sendToDevice: async (token, message) => {
      calls.push({ tokens: [token], message });
      return { token, accepted: true, invalidToken: false };
    },
    sendToDevices: async (tokens, message) => {
      calls.push({ tokens, message });
      return tokens.map((token) => ({ token, accepted: true, invalidToken: false }));
    },
  };
  return { provider, calls };
}

function makeThrowingProvider(): PushProvider {
  return {
    isValidToken: () => true,
    sendToDevice: async () => {
      throw new Error("simulated push provider outage");
    },
    sendToDevices: async () => {
      throw new Error("simulated push provider outage");
    },
  };
}

async function registerDevice(app: FastifyInstance, token: string, deviceToken: string) {
  const response = await app.inject({
    method: "POST",
    url: "/devices",
    headers: authHeader(token),
    payload: { token: deviceToken, platform: "ios" },
  });
  expect(response.statusCode).toBe(201);
}

describe("notification triggers", () => {
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

  describe("lead created", () => {
    it("sends a push to the business owner with the correct payload", async () => {
      const { token, userId, businessId } = await registerAccount(app);
      const deviceToken = "ExponentPushToken[lead-owner-aaaaaaaaaaaa]";
      await registerDevice(app, token, deviceToken);

      const { provider, calls } = makeCapturingProvider();
      await createLead(
        businessId,
        userId,
        { urgency: "high", serviceRequested: "roof repair" } as never,
        provider,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]?.tokens).toEqual([deviceToken]);
      expect(calls[0]?.message.body).toContain("roof repair");
      expect(calls[0]?.message.data).toMatchObject({ type: "lead", urgency: "high" });
    });

    it("does not notify an unrelated business's owner (tenant isolation)", async () => {
      const ownerA = await registerAccount(app, { email: "lead-tenant-a@example.com" });
      const ownerB = await registerAccount(app, { email: "lead-tenant-b@example.com" });
      await registerDevice(app, ownerA.token, "ExponentPushToken[lead-tenant-a-aaaaaaaa]");
      await registerDevice(app, ownerB.token, "ExponentPushToken[lead-tenant-b-bbbbbbbb]");

      const { provider, calls } = makeCapturingProvider();
      await createLead(ownerA.businessId, ownerA.userId, { urgency: "medium" } as never, provider);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.tokens).toEqual(["ExponentPushToken[lead-tenant-a-aaaaaaaa]"]);
    });

    it("still creates the lead and its activity event when push delivery fails", async () => {
      const { token, userId, businessId } = await registerAccount(app);
      await registerDevice(app, token, "ExponentPushToken[lead-fail-aaaaaaaaaaaaa]");

      const lead = await createLead(
        businessId,
        userId,
        { urgency: "low" } as never,
        makeThrowingProvider(),
      );

      expect(lead.status).toBe("new");
      expect(await prisma.lead.count({ where: { businessId } })).toBe(1);
      const events = await prisma.activityEvent.findMany({
        where: { businessId, eventType: "LEAD_CREATED", entityId: lead.id },
      });
      expect(events).toHaveLength(1);
    });

    it("does not attempt delivery when the owner has no active device", async () => {
      const { userId, businessId } = await registerAccount(app);

      const { provider, calls } = makeCapturingProvider();
      const lead = await createLead(businessId, userId, { urgency: "medium" } as never, provider);

      expect(lead.status).toBe("new");
      expect(calls).toHaveLength(0);
    });
  });

  describe("feedback received", () => {
    it("sends a push to the business owner with rating and comment", async () => {
      const { token, userId, businessId } = await registerAccount(app);
      const deviceToken = "ExponentPushToken[feedback-owner-aaaaaaaaaa]";
      await registerDevice(app, token, deviceToken);

      const { provider, calls } = makeCapturingProvider();
      await createFeedback(
        businessId,
        userId,
        { rating: 2, comment: "Waited 45 minutes past the appointment time" } as never,
        provider,
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]?.tokens).toEqual([deviceToken]);
      expect(calls[0]?.message.title).toBe("New feedback needs attention");
      expect(calls[0]?.message.body).toContain("2/5");
      expect(calls[0]?.message.data).toMatchObject({ type: "feedback" });
    });

    it("does not notify an unrelated business's owner (tenant isolation)", async () => {
      const ownerA = await registerAccount(app, { email: "feedback-tenant-a@example.com" });
      const ownerB = await registerAccount(app, { email: "feedback-tenant-b@example.com" });
      await registerDevice(app, ownerA.token, "ExponentPushToken[feedback-tenant-a-aaaa]");
      await registerDevice(app, ownerB.token, "ExponentPushToken[feedback-tenant-b-bbbb]");

      const { provider, calls } = makeCapturingProvider();
      await createFeedback(ownerA.businessId, ownerA.userId, { rating: 5 } as never, provider);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.tokens).toEqual(["ExponentPushToken[feedback-tenant-a-aaaa]"]);
    });

    it("still creates the feedback row when push delivery fails", async () => {
      const { token, userId, businessId } = await registerAccount(app);
      await registerDevice(app, token, "ExponentPushToken[feedback-fail-aaaaaaaaaa]");

      const feedback = await createFeedback(
        businessId,
        userId,
        { rating: 3 } as never,
        makeThrowingProvider(),
      );

      expect(await prisma.feedback.count({ where: { id: feedback.id } })).toBe(1);
    });

    it("sends exactly one push when feedback is submitted against a review request (not two)", async () => {
      // createFeedback internally also flips the linked review request to
      // feedback_received via markReviewRequestFeedbackReceived, which
      // records its own FEEDBACK_RECEIVED activity event against a
      // different entity (the review request). That must not translate into
      // a second push for what the owner experiences as one event.
      const { token, userId, businessId } = await registerAccount(app);
      await registerDevice(app, token, "ExponentPushToken[feedback-single-aaaaaaaa]");

      const reviewRequest = await createReviewRequest(businessId, userId, {} as never);

      const { provider, calls } = makeCapturingProvider();
      await createFeedback(
        businessId,
        userId,
        { reviewRequestId: reviewRequest.id, rating: 4, comment: "Good service" } as never,
        provider,
      );

      expect(calls).toHaveLength(1);

      const activityEvents = await prisma.activityEvent.findMany({
        where: { businessId, eventType: "FEEDBACK_RECEIVED" },
      });
      // Two activity events are expected (feedback entity + review_request
      // transition) — only the push count must stay at one.
      expect(activityEvents).toHaveLength(2);
    });
  });

  describe("review received", () => {
    it("sends a push to the business owner mentioning the service", async () => {
      const { token, userId, businessId } = await registerAccount(app);
      const deviceToken = "ExponentPushToken[review-owner-aaaaaaaaaaaa]";
      await registerDevice(app, token, deviceToken);

      const reviewRequest = await createReviewRequest(businessId, userId, { serviceName: "deep clean" } as never);

      const { provider, calls } = makeCapturingProvider();
      await markReviewRequestReviewed(businessId, userId, reviewRequest.id, provider);

      expect(calls).toHaveLength(1);
      expect(calls[0]?.tokens).toEqual([deviceToken]);
      expect(calls[0]?.message.body).toContain("deep clean");
      expect(calls[0]?.message.data).toMatchObject({ type: "review_request", reviewRequestId: reviewRequest.id });
    });

    it("sends only one push when mark-reviewed is called twice for the same review request", async () => {
      const { token, userId, businessId } = await registerAccount(app);
      await registerDevice(app, token, "ExponentPushToken[review-dup-aaaaaaaaaaaa]");

      const reviewRequest = await createReviewRequest(businessId, userId, {} as never);

      const { provider, calls } = makeCapturingProvider();
      await markReviewRequestReviewed(businessId, userId, reviewRequest.id, provider);
      await markReviewRequestReviewed(businessId, userId, reviewRequest.id, provider);

      expect(calls).toHaveLength(1);
      const events = await prisma.activityEvent.findMany({
        where: { businessId, eventType: "REVIEW_RECEIVED", entityId: reviewRequest.id },
      });
      expect(events).toHaveLength(1);
    });

    it("sends only one push when two mark-reviewed requests race for the same review request", async () => {
      const { token, userId, businessId } = await registerAccount(app);
      await registerDevice(app, token, "ExponentPushToken[review-race-aaaaaaaaaaaa]");

      const reviewRequest = await createReviewRequest(businessId, userId, {} as never);

      const { provider, calls } = makeCapturingProvider();
      await Promise.all([
        markReviewRequestReviewed(businessId, userId, reviewRequest.id, provider),
        markReviewRequestReviewed(businessId, userId, reviewRequest.id, provider),
      ]);

      expect(calls).toHaveLength(1);
    });

    it("still transitions the review request when push delivery fails", async () => {
      const { token, userId, businessId } = await registerAccount(app);
      await registerDevice(app, token, "ExponentPushToken[review-fail-aaaaaaaaaaaa]");

      const reviewRequest = await createReviewRequest(businessId, userId, {} as never);
      const updated = await markReviewRequestReviewed(businessId, userId, reviewRequest.id, makeThrowingProvider());

      expect(updated.status).toBe("reviewed");
    });
  });

  describe("inactive devices", () => {
    it("does not deliver to a device the owner has removed", async () => {
      const { token, userId, businessId } = await registerAccount(app);
      const deviceToken = "ExponentPushToken[removed-device-aaaaaaaaaa]";
      await registerDevice(app, token, deviceToken);
      await app.inject({
        method: "DELETE",
        url: `/devices/${encodeURIComponent(deviceToken)}`,
        headers: authHeader(token),
      });

      const { provider, calls } = makeCapturingProvider();
      await createLead(businessId, userId, { urgency: "medium" } as never, provider);

      expect(calls).toHaveLength(0);
    });
  });
});
