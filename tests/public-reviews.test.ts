import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { submitPublicFeedback } from "../src/modules/public/publicReviews.service.js";
import type { PushProvider } from "../src/lib/push/pushProvider.js";

function makeFakePushProvider() {
  const calls: string[][] = [];
  const provider: PushProvider = {
    isValidToken: () => true,
    sendToDevice: async (t) => { calls.push([t]); return { token: t, accepted: true, invalidToken: false }; },
    sendToDevices: async (tokens) => { calls.push(tokens); return tokens.map((t) => ({ token: t, accepted: true, invalidToken: false })); },
  };
  return { provider, calls };
}

async function createReviewRequestWithPublicLink(
  app: FastifyInstance,
  token: string,
  overrides: { customerId?: string; serviceName?: string } = {},
) {
  const created = await app.inject({
    method: "POST",
    url: "/review-requests",
    headers: authHeader(token),
    payload: { customerId: overrides.customerId, serviceName: overrides.serviceName ?? "Haircut" },
  });
  expect(created.statusCode).toBe(201);
  const reviewRequestId = created.json().id;

  const linked = await app.inject({
    method: "POST",
    url: `/review-requests/${reviewRequestId}/public-link`,
    headers: authHeader(token),
  });
  expect(linked.statusCode).toBe(200);

  return { reviewRequestId, publicToken: linked.json().token as string, expiresAt: linked.json().expiresAt as string };
}

describe("public review/private-feedback flow", () => {
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

  // ---------------------------------------------------------------------
  // Token properties
  // ---------------------------------------------------------------------

  it("1. issues a cryptographically nontrivial token", async () => {
    const { token } = await registerAccount(app);
    const { publicToken } = await createReviewRequestWithPublicLink(app, token);

    // id.secret shape (see src/lib/authTokens.ts) — long, high-entropy,
    // never a short/sequential value.
    expect(publicToken.length).toBeGreaterThan(40);
    expect(publicToken).toMatch(/^[0-9a-f-]+\.[A-Za-z0-9_-]+$/);
  });

  it("2. issues a unique token per review request", async () => {
    const { token } = await registerAccount(app);
    const first = await createReviewRequestWithPublicLink(app, token);
    const second = await createReviewRequestWithPublicLink(app, token);

    expect(first.publicToken).not.toBe(second.publicToken);
  });

  it("does not regenerate a fresh token merely from GET /review-requests/:id", async () => {
    const { token } = await registerAccount(app);
    const { reviewRequestId } = await createReviewRequestWithPublicLink(app, token);
    const before = await prisma.reviewRequest.findUniqueOrThrow({ where: { id: reviewRequestId } });

    await app.inject({ method: "GET", url: `/review-requests/${reviewRequestId}`, headers: authHeader(token) });

    const after = await prisma.reviewRequest.findUniqueOrThrow({ where: { id: reviewRequestId } });
    expect(after.publicTokenId).toBe(before.publicTokenId);
    expect(after.publicTokenHash).toBe(before.publicTokenHash);
  });

  // ---------------------------------------------------------------------
  // Public GET
  // ---------------------------------------------------------------------

  it("3. resolves a valid token", async () => {
    const { token } = await registerAccount(app, { businessName: "Sparkle Clean" });
    const { publicToken } = await createReviewRequestWithPublicLink(app, token, { serviceName: "Deep clean" });

    const response = await app.inject({ method: "GET", url: `/public/reviews/${publicToken}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ state: "open", business: { name: "Sparkle Clean" }, serviceName: "Deep clean" });
  });

  it("4. returns a generic 404 for an invalid token", async () => {
    const response = await app.inject({ method: "GET", url: "/public/reviews/not-a-real-token" });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
  });

  it("4b. returns a generic 404 for a well-formed but nonexistent token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/public/reviews/00000000-0000-0000-0000-000000000000.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });

    expect(response.statusCode).toBe(404);
  });

  it("5. rejects an expired token without leaking business data", async () => {
    const { token } = await registerAccount(app, { businessName: "Should Not Leak Co" });
    const { reviewRequestId, publicToken } = await createReviewRequestWithPublicLink(app, token);
    await prisma.reviewRequest.update({ where: { id: reviewRequestId }, data: { publicTokenExpiresAt: new Date(Date.now() - 1000) } });

    const response = await app.inject({ method: "GET", url: `/public/reviews/${publicToken}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ state: "expired" });
    expect(JSON.stringify(response.json())).not.toContain("Should Not Leak Co");
  });

  it("6. reflects consumed-token state after a submission", async () => {
    const { token } = await registerAccount(app);
    const { publicToken } = await createReviewRequestWithPublicLink(app, token);

    await app.inject({ method: "POST", url: `/public/reviews/${publicToken}/feedback`, payload: { rating: 5, comment: "Great!" } });
    const response = await app.inject({ method: "GET", url: `/public/reviews/${publicToken}` });

    expect(response.statusCode).toBe(200);
    expect(response.json().state).toBe("submitted");
  });

  it("7. never exposes businessId in the public response", async () => {
    const { token } = await registerAccount(app);
    const { publicToken } = await createReviewRequestWithPublicLink(app, token);

    const response = await app.inject({ method: "GET", url: `/public/reviews/${publicToken}` });

    expect(JSON.stringify(response.json())).not.toMatch(/businessId/i);
  });

  it("8. never exposes customer PII in the public response", async () => {
    const { token } = await registerAccount(app);
    const customer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(token),
      payload: { name: "Jane Private", phone: "+15551234567", email: "jane@example.com" },
    });
    const { publicToken } = await createReviewRequestWithPublicLink(app, token, { customerId: customer.json().id });

    const response = await app.inject({ method: "GET", url: `/public/reviews/${publicToken}` });
    const body = JSON.stringify(response.json());

    expect(body).not.toContain("Jane Private");
    expect(body).not.toContain("+15551234567");
    expect(body).not.toContain("jane@example.com");
    expect(body).not.toMatch(/customerId/i);
  });

  // ---------------------------------------------------------------------
  // Public POST — submission
  // ---------------------------------------------------------------------

  it("9. accepts a valid feedback submission", async () => {
    const { token } = await registerAccount(app);
    const { publicToken } = await createReviewRequestWithPublicLink(app, token);

    const response = await app.inject({
      method: "POST",
      url: `/public/reviews/${publicToken}/feedback`,
      payload: { rating: 2, comment: "Not great" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ state: "submitted" });
  });

  it("10. rejects an out-of-range rating", async () => {
    const { token } = await registerAccount(app);
    const { publicToken } = await createReviewRequestWithPublicLink(app, token);

    const tooHigh = await app.inject({ method: "POST", url: `/public/reviews/${publicToken}/feedback`, payload: { rating: 6 } });
    const tooLow = await app.inject({ method: "POST", url: `/public/reviews/${publicToken}/feedback`, payload: { rating: 0 } });

    expect(tooHigh.statusCode).toBe(400);
    expect(tooLow.statusCode).toBe(400);
    expect(await prisma.feedback.count()).toBe(0);
  });

  it("11. rejects an overlong comment and treats an empty comment as none", async () => {
    const { token } = await registerAccount(app);
    const { publicToken: tokenA } = await createReviewRequestWithPublicLink(app, token);

    const tooLong = await app.inject({
      method: "POST",
      url: `/public/reviews/${tokenA}/feedback`,
      payload: { rating: 3, comment: "x".repeat(2001) },
    });
    expect(tooLong.statusCode).toBe(400);

    const { publicToken: tokenB } = await createReviewRequestWithPublicLink(app, token);
    const emptyComment = await app.inject({
      method: "POST",
      url: `/public/reviews/${tokenB}/feedback`,
      payload: { rating: 4, comment: "   " },
    });
    expect(emptyComment.statusCode).toBe(201);
    const feedback = await prisma.feedback.findFirstOrThrow({ where: { rating: 4 } });
    expect(feedback.comment).toBeNull();
  });

  it("12. does not create a duplicate Feedback row on a repeated submission", async () => {
    const { token } = await registerAccount(app);
    const { publicToken } = await createReviewRequestWithPublicLink(app, token);

    const first = await app.inject({ method: "POST", url: `/public/reviews/${publicToken}/feedback`, payload: { rating: 5 } });
    const second = await app.inject({ method: "POST", url: `/public/reviews/${publicToken}/feedback`, payload: { rating: 1 } });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ state: "submitted" });
    expect(await prisma.feedback.count()).toBe(1);
  });

  it("12b. concurrent duplicate submissions still create exactly one Feedback row", async () => {
    const { token } = await registerAccount(app);
    const { publicToken } = await createReviewRequestWithPublicLink(app, token);

    const [a, b] = await Promise.all([
      app.inject({ method: "POST", url: `/public/reviews/${publicToken}/feedback`, payload: { rating: 5 } }),
      app.inject({ method: "POST", url: `/public/reviews/${publicToken}/feedback`, payload: { rating: 1 } }),
    ]);

    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
    expect(await prisma.feedback.count()).toBe(1);
  });

  it("13. updates ReviewRequest status to feedback_received on submission", async () => {
    const { token } = await registerAccount(app);
    const { reviewRequestId, publicToken } = await createReviewRequestWithPublicLink(app, token);

    await app.inject({ method: "POST", url: `/public/reviews/${publicToken}/feedback`, payload: { rating: 5 } });

    const reviewRequest = await prisma.reviewRequest.findUniqueOrThrow({ where: { id: reviewRequestId } });
    expect(reviewRequest.status).toBe("feedback_received");
  });

  it("14. links the created Feedback to the correct business, review request, and customer", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await app.inject({ method: "POST", url: "/customers", headers: authHeader(token), payload: { name: "Linked Customer" } });
    const { reviewRequestId, publicToken } = await createReviewRequestWithPublicLink(app, token, { customerId: customer.json().id });

    await app.inject({ method: "POST", url: `/public/reviews/${publicToken}/feedback`, payload: { rating: 5 } });

    const feedback = await prisma.feedback.findFirstOrThrow({ where: { reviewRequestId } });
    expect(feedback.businessId).toBe(businessId);
    expect(feedback.reviewRequestId).toBe(reviewRequestId);
    expect(feedback.customerId).toBe(customer.json().id);
  });

  // ---------------------------------------------------------------------
  // Tenant isolation / spoofing
  // ---------------------------------------------------------------------

  it("15. Business A's token cannot resolve or affect Business B's data", async () => {
    const businessA = await registerAccount(app, { email: "public-a@example.com", businessName: "Business A" });
    const businessB = await registerAccount(app, { email: "public-b@example.com", businessName: "Business B" });
    const { publicToken } = await createReviewRequestWithPublicLink(app, businessA.token);

    const response = await app.inject({ method: "GET", url: `/public/reviews/${publicToken}` });

    expect(response.json().business.name).toBe("Business A");
    expect(response.json().business.name).not.toBe("Business B");
    expect(await prisma.reviewRequest.count({ where: { businessId: businessB.businessId } })).toBe(0);
  });

  it("16. ignores a client-supplied businessId in the submission body", async () => {
    const { token, businessId } = await registerAccount(app);
    const other = await registerAccount(app, { email: "forge-business@example.com" });
    const { publicToken } = await createReviewRequestWithPublicLink(app, token);

    const response = await app.inject({
      method: "POST",
      url: `/public/reviews/${publicToken}/feedback`,
      payload: { rating: 5, businessId: other.businessId },
    });

    expect(response.statusCode).toBe(201);
    const feedback = await prisma.feedback.findFirstOrThrow({});
    expect(feedback.businessId).toBe(businessId);
    expect(feedback.businessId).not.toBe(other.businessId);
  });

  it("17. ignores a client-supplied customerId in the submission body", async () => {
    const { token } = await registerAccount(app);
    const other = await registerAccount(app, { email: "forge-customer@example.com" });
    const foreignCustomer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: authHeader(other.token),
      payload: { name: "Not Yours" },
    });
    const { publicToken } = await createReviewRequestWithPublicLink(app, token); // no customerId on this review request

    const response = await app.inject({
      method: "POST",
      url: `/public/reviews/${publicToken}/feedback`,
      payload: { rating: 5, customerId: foreignCustomer.json().id },
    });

    expect(response.statusCode).toBe(201);
    const feedback = await prisma.feedback.findFirstOrThrow({});
    expect(feedback.customerId).toBeNull(); // derived from the review request, not the forged body field
  });

  it("18. works without any authentication", async () => {
    const { token } = await registerAccount(app);
    const { publicToken } = await createReviewRequestWithPublicLink(app, token);

    const response = await app.inject({ method: "GET", url: `/public/reviews/${publicToken}` }); // no Authorization header

    expect(response.statusCode).toBe(200);
  });

  it("19. leaves authenticated review/feedback routes unchanged", async () => {
    const { token } = await registerAccount(app);

    const created = await app.inject({
      method: "POST",
      url: "/review-requests",
      headers: authHeader(token),
      payload: { serviceName: "Manual flow" },
    });
    expect(created.statusCode).toBe(201);

    const feedback = await app.inject({
      method: "POST",
      url: "/feedback",
      headers: authHeader(token),
      payload: { rating: 5 },
    });
    expect(feedback.statusCode).toBe(201);
  });

  // ---------------------------------------------------------------------
  // Side effects
  // ---------------------------------------------------------------------

  it("20. triggers exactly one push notification for a submission", async () => {
    const { token, businessId } = await registerAccount(app);
    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: "ExponentPushToken[public-feedback-aaaaaaaaaa]", platform: "ios" },
    });
    const rule = await createReviewRequestWithPublicLink(app, token);
    const { provider, calls } = makeFakePushProvider();

    await submitPublicFeedback(rule.publicToken, { rating: 1, comment: "Unhappy" }, provider);

    expect(calls).toHaveLength(1);
    expect(await prisma.activityEvent.count({ where: { businessId, eventType: "FEEDBACK_RECEIVED" } })).toBeGreaterThanOrEqual(1);
  });

  it("20b. does not send a second push on a duplicate submission attempt", async () => {
    const { token } = await registerAccount(app);
    await app.inject({
      method: "POST",
      url: "/devices",
      headers: authHeader(token),
      payload: { token: "ExponentPushToken[public-feedback-dup-aaaaaaaa]", platform: "ios" },
    });
    const { publicToken } = await createReviewRequestWithPublicLink(app, token);
    const { provider, calls } = makeFakePushProvider();

    await submitPublicFeedback(publicToken, { rating: 1 }, provider);
    await submitPublicFeedback(publicToken, { rating: 5 }, provider); // same token, already consumed

    expect(calls).toHaveLength(1);
  });

  // ---------------------------------------------------------------------
  // Rate limiting
  // ---------------------------------------------------------------------

  it("21. rate limits the public feedback submission route", async () => {
    const isolatedApp = await createTestApp({ enableRateLimit: true });
    const { token } = await registerAccount(isolatedApp);
    const responses = [];
    for (let index = 0; index < 11; index += 1) {
      const { publicToken } = await createReviewRequestWithPublicLink(isolatedApp, token);
      responses.push(await isolatedApp.inject({ method: "POST", url: `/public/reviews/${publicToken}/feedback`, payload: { rating: 5 } }));
    }

    expect(responses.slice(0, 10).every((r) => r.statusCode === 201)).toBe(true);
    expect(responses[10]!.statusCode).toBe(429);
    expect(responses[10]!.json().error.code).toBe("RATE_LIMITED");
    await isolatedApp.close();
  });
});
