import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan, setSubscriptionStatus } from "./helpers.js";
import { sendDueReviewRequests } from "../src/modules/reviews/reviewAutomation.js";
import type { MessagingProvider, OutboundMessage } from "../src/lib/messaging/messagingProvider.js";

function fake(accept = true) {
  const calls: OutboundMessage[] = [];
  const provider: MessagingProvider = {
    id: "fake",
    supportsChannel: () => true,
    send: async (m: OutboundMessage) => { calls.push(m); return { accepted: accept, providerMessageId: `SM-${calls.length}`, permanentFailure: !accept }; },
    parseDeliveryWebhook: () => null,
    parseInboundWebhook: () => null,
    verifyWebhookSignature: () => false,
  };
  return { provider, calls };
}

describe("automatic review requests (#20)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function biz(email = "rev-owner@ex.com", opts: { auto?: boolean; delayHours?: number; intervalDays?: number; consent?: boolean } = {}) {
    const account = await registerAccount(app, { email });
    await setPlan(account.businessId, "BUSINESS");
    await setSubscriptionStatus(account.businessId, "ACTIVE");
    await prisma.business.update({
      where: { id: account.businessId },
      data: {
        messagingConsentConfirmedAt: opts.consent === false ? null : new Date(),
        reviewRequestAutoEnabled: opts.auto ?? true,
        reviewRequestDelayHours: opts.delayHours ?? 24,
        reviewRequestMinIntervalDays: opts.intervalDays ?? 45,
        googleReviewLink: "https://g.page/r/demo/review",
      },
    });
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Pat", phone: "+15005550070", phoneE164: "+15005550070" } });
    return { ...account, customer };
  }

  /** A COMPLETED appointment that ended `endedHoursAgo` ago. */
  const completed = (businessId: string, customerId: string, endedHoursAgo = 48) =>
    prisma.appointment.create({
      data: {
        businessId, customerId, serviceName: "Cut",
        startsAt: new Date(Date.now() - (endedHoursAgo + 1) * 3_600_000),
        endsAt: new Date(Date.now() - endedHoursAgo * 3_600_000),
        status: "COMPLETED", createdByUserId: "seed",
      },
    });

  it("sends one review request for an eligible completed appointment, once", async () => {
    const b = await biz();
    const appt = await completed(b.businessId, b.customer.id, 48);
    const { provider, calls } = fake();

    expect(await sendDueReviewRequests(provider, 50, new Date())).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.to).toBe("+15005550070");
    expect(calls[0]!.body.toLowerCase()).toContain("review");

    const rr = await prisma.reviewRequest.findFirstOrThrow({ where: { businessId: b.businessId } });
    expect(rr.appointmentId).toBe(appt.id);
    expect(rr.status).toBe("sent");
    expect(rr.publicTokenId).not.toBeNull();
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).reviewRequestSentAt).not.toBeNull();
    expect(await prisma.message.count({ where: { businessId: b.businessId, messageType: "review_request" } })).toBe(1);

    // idempotent: a second sweep sends nothing more
    await sendDueReviewRequests(provider, 50, new Date());
    expect(calls).toHaveLength(1);
    expect(await prisma.reviewRequest.count({ where: { businessId: b.businessId } })).toBe(1);
  });

  it("does not send before the business's configured delay has elapsed", async () => {
    const b = await biz("rev-delay@ex.com", { delayHours: 24 });
    await completed(b.businessId, b.customer.id, 2); // ended 2h ago, delay is 24h
    const { provider, calls } = fake();
    expect(await sendDueReviewRequests(provider, 50, new Date())).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("does nothing when the business has automatic requests disabled", async () => {
    const b = await biz("rev-off@ex.com", { auto: false });
    await completed(b.businessId, b.customer.id, 48);
    const { provider, calls } = fake();
    await sendDueReviewRequests(provider, 50, new Date());
    expect(calls).toHaveLength(0);
    expect(await prisma.reviewRequest.count({ where: { businessId: b.businessId } })).toBe(0);
  });

  it("does nothing when messaging consent has not been confirmed", async () => {
    const b = await biz("rev-noconsent@ex.com", { consent: false });
    const appt = await completed(b.businessId, b.customer.id, 48);
    const { provider, calls } = fake();
    await sendDueReviewRequests(provider, 50, new Date());
    expect(calls).toHaveLength(0);
    // not a candidate -> claim column untouched
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).reviewRequestSentAt).toBeNull();
  });

  it("respects the per-customer window and never suppresses based on a prior low rating", async () => {
    const b = await biz("rev-window@ex.com", { intervalDays: 45 });
    // a prior request 10 days ago + a 1-star review -> inside the window, skip,
    // but the skip is a windowing decision, NOT sentiment suppression.
    const prior = await prisma.reviewRequest.create({ data: { businessId: b.businessId, customerId: b.customer.id, createdAt: new Date(Date.now() - 10 * 86_400_000) } });
    await prisma.feedback.create({ data: { businessId: b.businessId, customerId: b.customer.id, reviewRequestId: prior.id, rating: 1, comment: "bad", sentiment: "negative" } });

    const recentAppt = await completed(b.businessId, b.customer.id, 48);
    const { provider, calls } = fake();
    await sendDueReviewRequests(provider, 50, new Date());
    expect(calls).toHaveLength(0); // windowed out, not asked again yet
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: recentAppt.id } })).reviewRequestSentAt).not.toBeNull(); // terminal skip, claimed

    // once the window has passed, the same (previously negative) customer IS asked again
    await prisma.reviewRequest.update({ where: { id: prior.id }, data: { createdAt: new Date(Date.now() - 60 * 86_400_000) } });
    await prisma.appointment.update({ where: { id: recentAppt.id }, data: { reviewRequestSentAt: null } });
    await sendDueReviewRequests(provider, 50, new Date());
    expect(calls).toHaveLength(1);
  });

  it("skips a customer who has opted out of SMS", async () => {
    const b = await biz("rev-optout@ex.com");
    const appt = await completed(b.businessId, b.customer.id, 48);
    await prisma.customerOptOut.create({ data: { businessId: b.businessId, customerId: b.customer.id, phone: "+15005550070", channel: "SMS", source: "test" } });
    const { provider, calls } = fake();
    await sendDueReviewRequests(provider, 50, new Date());
    expect(calls).toHaveLength(0);
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).reviewRequestSentAt).not.toBeNull();
    expect(await prisma.reviewRequest.count({ where: { businessId: b.businessId } })).toBe(0);
  });

  it("a provider soft-failure releases the claim and removes the half-created request so the next sweep retries", async () => {
    const b = await biz("rev-retry@ex.com");
    const appt = await completed(b.businessId, b.customer.id, 48);
    await sendDueReviewRequests(fake(false).provider, 50, new Date());
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appt.id } })).reviewRequestSentAt).toBeNull();
    expect(await prisma.reviewRequest.count({ where: { businessId: b.businessId } })).toBe(0);

    const ok = fake(true);
    await sendDueReviewRequests(ok.provider, 50, new Date());
    expect(ok.calls).toHaveLength(1);
    expect(await prisma.reviewRequest.count({ where: { businessId: b.businessId, status: "sent" } })).toBe(1);
  });

  it("is tenant isolated", async () => {
    const a = await biz("rev-isoA@ex.com");
    const other = await biz("rev-isoB@ex.com");
    await completed(a.businessId, a.customer.id, 48);
    await sendDueReviewRequests(fake().provider, 50, new Date());
    expect(await prisma.reviewRequest.count({ where: { businessId: other.businessId } })).toBe(0);
  });
});

describe("review response workflow + metrics (#20)", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function seed(email = "rr-owner@ex.com") {
    const account = await registerAccount(app, { email });
    await setPlan(account.businessId, "BUSINESS");
    await setSubscriptionStatus(account.businessId, "ACTIVE");
    const business = await prisma.business.update({ where: { id: account.businessId }, data: { industry: "hair salon" }, select: { publicSlug: true } });
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Rev", phone: "+15005550075", phoneE164: "+15005550075" } });
    return { ...account, slug: business.publicSlug as string, customer };
  }

  it("a business responds to a review and the reply shows on the public profile; empty clears it", async () => {
    const b = await seed();
    const fb = await prisma.feedback.create({ data: { businessId: b.businessId, customerId: b.customer.id, rating: 2, comment: "slow service", sentiment: "negative" } });

    const res = await app.inject({ method: "POST", url: `/feedback/${fb.id}/respond`, headers: authHeader(b.token), payload: { response: "Sorry about the wait — we've added staff on Saturdays." } });
    expect(res.statusCode).toBe(200);
    expect(res.json().response).toContain("added staff");
    const stored = await prisma.feedback.findUniqueOrThrow({ where: { id: fb.id } });
    expect(stored.respondedAt).not.toBeNull();
    expect(stored.respondedByUserId).toBe(b.userId);

    const customer = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email: `pub-${Date.now()}@ex.com`, password: "password123", fullName: "Public Viewer" } }).then(r => r.json());
    const profile = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${b.slug}`, headers: authHeader(customer.accessToken) }).then(r => r.json());
    const shown = profile.reviewsSummary.recent.find((r: { comment: string }) => r.comment === "slow service");
    expect(shown.response).toContain("added staff");

    // empty string clears the reply
    await app.inject({ method: "POST", url: `/feedback/${fb.id}/respond`, headers: authHeader(b.token), payload: { response: "" } });
    expect((await prisma.feedback.findUniqueOrThrow({ where: { id: fb.id } })).response).toBeNull();
  });

  it("respond and metrics are tenant scoped", async () => {
    const a = await seed("rr-isoA@ex.com");
    const other = await seed("rr-isoB@ex.com");
    const fb = await prisma.feedback.create({ data: { businessId: a.businessId, customerId: a.customer.id, rating: 5, comment: "great" } });
    expect((await app.inject({ method: "POST", url: `/feedback/${fb.id}/respond`, headers: authHeader(other.token), payload: { response: "hi" } })).statusCode).toBe(404);
  });

  it("metrics report the request funnel, rating average and response rate", async () => {
    const b = await seed("rr-metrics@ex.com");
    const rr1 = await prisma.reviewRequest.create({ data: { businessId: b.businessId, customerId: b.customer.id, status: "sent", sentAt: new Date() } });
    await prisma.reviewRequest.create({ data: { businessId: b.businessId, customerId: b.customer.id, status: "sent", sentAt: new Date() } });
    await prisma.reviewRequest.update({ where: { id: rr1.id }, data: { status: "reviewed" } });
    await prisma.feedback.create({ data: { businessId: b.businessId, customerId: b.customer.id, reviewRequestId: rr1.id, rating: 4, comment: "good" } });
    const responded = await prisma.feedback.create({ data: { businessId: b.businessId, customerId: b.customer.id, rating: 2, comment: "meh" } });
    await app.inject({ method: "POST", url: `/feedback/${responded.id}/respond`, headers: authHeader(b.token), payload: { response: "thanks for the feedback" } });

    const m = await app.inject({ method: "GET", url: "/review-requests/metrics", headers: authHeader(b.token) }).then(r => r.json());
    expect(m.conversion.sentTotal).toBe(2);
    expect(m.conversion.convertedTotal).toBe(1);
    expect(m.conversion.rateAllTime).toBe(0.5);
    expect(m.ratings.average).toBe(3);
    expect(m.ratings.count).toBe(2);
    expect(m.responses.responded).toBe(1);
    expect(m.responses.total).toBe(2);
  });
});
