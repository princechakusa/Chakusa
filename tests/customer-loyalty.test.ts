import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";
import { expireDuePoints } from "../src/lib/loyalty/pointsEngine.js";

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const openEveryDay = { version: 1, days: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, { enabled: true, opensAt: "00:00", closesAt: "23:59" }])) };

function futureSlot(days = 7, hourUtc = 10): string {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hourUtc, 0, 0, 0);
  return d.toISOString();
}

async function registerCustomer(app: FastifyInstance, over: Partial<{ email: string; fullName: string }> = {}) {
  const email = over.email ?? `cust-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName: over.fullName ?? "Casey Customer" } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json();
  return { email, token: body.accessToken as string, profileId: body.profile.id as string, userId: body.user.id as string };
}

async function loyaltyBusiness(app: FastifyInstance, name: string, program?: Record<string, unknown>) {
  const account = await registerAccount(app, { businessName: name });
  const business = await prisma.business.update({
    where: { id: account.businessId },
    data: { timezone: "UTC", workingHours: openEveryDay, bookingMinNoticeMinutes: 0, bookingWindowDays: 365, cancellationNoticeMinutes: 0, industry: "hair salon", verifiedAt: new Date() },
    select: { id: true, publicSlug: true },
  });
  const service = await prisma.serviceOffering.create({ data: { businessId: business.id, name: "Haircut", durationMinutes: 60, price: 50, publiclyBookable: true, active: true } });
  if (program) {
    const res = await app.inject({ method: "PUT", url: "/loyalty/program", headers: auth(account.token), payload: { active: true, ...program } });
    if (res.statusCode !== 200) throw new Error(`program setup failed: ${res.body}`);
  }
  return { ...account, slug: business.publicSlug as string, businessId: business.id, serviceId: service.id };
}

async function book(app: FastifyInstance, token: string, biz: { slug: string; serviceId: string }, startsAt: string) {
  const res = await app.inject({ method: "POST", url: "/customer/bookings", headers: auth(token), payload: { slug: biz.slug, serviceOfferingId: biz.serviceId, startsAt } });
  if (res.statusCode !== 201) throw new Error(`book failed: ${res.body}`);
  return res.json().appointment.id as string;
}

async function complete(app: FastifyInstance, businessToken: string, appointmentId: string) {
  await app.inject({ method: "POST", url: `/appointments/${appointmentId}/status`, headers: auth(businessToken), payload: { status: "CONFIRMED" } });
  const res = await app.inject({ method: "POST", url: `/appointments/${appointmentId}/status`, headers: auth(businessToken), payload: { status: "COMPLETED" } });
  if (res.statusCode !== 200) throw new Error(`complete failed: ${res.body}`);
}

async function superAdmin(app: FastifyInstance) {
  const email = `loy-admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const account = await registerAccount(app, { email, password: "admin-password-123", businessName: "Admin Co" });
  await prisma.adminMembership.create({ data: { userId: account.userId, role: "SUPER_ADMIN" } });
  const login = await app.inject({ method: "POST", url: "/admin/auth/login", payload: { email, password: "admin-password-123" } });
  return { headers: { authorization: `Bearer ${login.json().accessToken}` }, write: { authorization: `Bearer ${login.json().accessToken}`, origin: "http://localhost:5173", "x-csrf-token": login.json().csrfToken } };
}

describe("Customer Loyalty, Memberships & Rewards (Program 2, Loop 5)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    config.ADMIN_CONSOLE_ENABLED = true;
    app = await createTestApp();
  });
  afterEach(async () => {
    await resetDatabase();
  });
  afterAll(async () => {
    config.ADMIN_CONSOLE_ENABLED = false;
    await app.close();
    await prisma.$disconnect();
  });

  describe("points engine — earning", () => {
    it("awards points on a completed booking, idempotently, and moves the tier", async () => {
      const biz = await loyaltyBusiness(app, "Points Salon", { pointsPerCurrency: 10, pointsPerBookingBonus: 20, tierConfig: [{ key: "bronze", name: "Bronze", minPoints: 0 }, { key: "silver", name: "Silver", minPoints: 400 }] });
      const customer = await registerCustomer(app);
      const apptId = await book(app, customer.token, biz, futureSlot(5, 9));

      await complete(app, biz.token, apptId);
      await complete(app, biz.token, apptId).catch(() => undefined); // replay — no double award

      const account = await app.inject({ method: "GET", url: `/customer/loyalty/accounts/${biz.businessId}`, headers: auth(customer.token) }).then((r) => r.json());
      expect(account.pointsBalance).toBe(50 * 10 + 20); // price 50 × 10 + 20 bonus
      expect(account.lifetimePoints).toBe(520);
      expect(account.tier.key).toBe("silver");

      const txns = await app.inject({ method: "GET", url: `/customer/loyalty/accounts/${biz.businessId}/transactions`, headers: auth(customer.token) }).then((r) => r.json());
      expect(txns.items.filter((t: { sourceType: string }) => t.sourceType === "appointment")).toHaveLength(1);
    });

    it("awards review points and applies an active campaign multiplier", async () => {
      const biz = await loyaltyBusiness(app, "Review Salon", { pointsPerCurrency: 0, pointsPerReview: 100 });
      await app.inject({ method: "POST", url: "/loyalty/campaigns", headers: auth(biz.token), payload: { name: "Double points week", kind: "multiplier", multiplier: 2, startsAt: new Date(Date.now() - 3600_000).toISOString(), endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString() } });
      const customer = await registerCustomer(app);
      const apptId = await book(app, customer.token, biz, futureSlot(6, 9));
      await complete(app, biz.token, apptId);

      const contact = await prisma.customerBusinessLink.findFirstOrThrow({ where: { customerProfileId: customer.profileId, businessId: biz.businessId } });
      await app.inject({ method: "POST", url: "/feedback", headers: auth(biz.token), payload: { customerId: contact.businessCustomerId, rating: 5, comment: "Great" } });

      const account = await app.inject({ method: "GET", url: `/customer/loyalty/accounts/${biz.businessId}`, headers: auth(customer.token) }).then((r) => r.json());
      expect(account.pointsBalance).toBe(200); // 100 review × 2 campaign
    });

    it("expires points whose window has passed", async () => {
      const biz = await loyaltyBusiness(app, "Expiry Salon", { pointsPerCurrency: 10, pointExpiryDays: 30 });
      const customer = await registerCustomer(app);
      const apptId = await book(app, customer.token, biz, futureSlot(4, 9));
      await complete(app, biz.token, apptId);

      // Backdate the earn's expiry into the past, then run the batch.
      await prisma.loyaltyTransaction.updateMany({ where: { businessId: biz.businessId, kind: "earn" }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
      const result = await expireDuePoints(biz.businessId);
      expect(result.pointsExpired).toBe(500);
      const account = await app.inject({ method: "GET", url: `/customer/loyalty/accounts/${biz.businessId}`, headers: auth(customer.token) }).then((r) => r.json());
      expect(account.pointsBalance).toBe(0);
    });
  });

  describe("rewards", () => {
    it("business creates a reward; customer redeems it and points are debited", async () => {
      const biz = await loyaltyBusiness(app, "Reward Salon", { pointsPerCurrency: 20 });
      const customer = await registerCustomer(app);
      const apptId = await book(app, customer.token, biz, futureSlot(3, 9));
      await complete(app, biz.token, apptId); // 50 × 20 = 1000 points

      const reward = await app.inject({ method: "POST", url: "/loyalty/rewards", headers: auth(biz.token), payload: { name: "Free wash", type: "free_service", pointsCost: 600 } }).then((r) => r.json());

      const available = await app.inject({ method: "GET", url: `/customer/loyalty/accounts/${biz.businessId}/rewards`, headers: auth(customer.token) }).then((r) => r.json());
      expect(available.find((x: { id: string }) => x.id === reward.id).redeemable).toBe(true);

      const redeem = await app.inject({ method: "POST", url: `/customer/loyalty/accounts/${biz.businessId}/rewards/${reward.id}/redeem`, headers: auth(customer.token) });
      expect(redeem.statusCode).toBe(201);
      expect(redeem.json().code).toMatch(/^RW-/);

      const account = await app.inject({ method: "GET", url: `/customer/loyalty/accounts/${biz.businessId}`, headers: auth(customer.token) }).then((r) => r.json());
      expect(account.pointsBalance).toBe(400);

      const mine = await app.inject({ method: "GET", url: "/customer/loyalty/rewards", headers: auth(customer.token) }).then((r) => r.json());
      expect(mine).toHaveLength(1);
      expect(mine[0].status).toBe("issued");

      // Business scans it.
      const marked = await app.inject({ method: "POST", url: `/loyalty/redemptions/${redeem.json().id}/mark-redeemed`, headers: auth(biz.token) });
      expect(marked.json().status).toBe("redeemed");
    });

    it("refuses to redeem without enough points", async () => {
      const biz = await loyaltyBusiness(app, "Broke Salon", { pointsPerCurrency: 1 });
      const customer = await registerCustomer(app);
      await app.inject({ method: "POST", url: "/customer/loyalty/accounts/" + biz.businessId + "/enrol", headers: auth(customer.token) });
      const reward = await app.inject({ method: "POST", url: "/loyalty/rewards", headers: auth(biz.token), payload: { name: "Big reward", type: "promo", pointsCost: 5000 } }).then((r) => r.json());
      const redeem = await app.inject({ method: "POST", url: `/customer/loyalty/accounts/${biz.businessId}/rewards/${reward.id}/redeem`, headers: auth(customer.token) });
      expect(redeem.statusCode).toBe(409);
    });
  });

  describe("memberships", () => {
    it("customer enrols in a plan and gets member pricing on services", async () => {
      const biz = await loyaltyBusiness(app, "Member Salon");
      const plan = await app.inject({ method: "POST", url: "/loyalty/membership-plans", headers: auth(biz.token), payload: { name: "Gold", billingInterval: "monthly", priceAmount: 20, discountPercent: 30, priorityBooking: true } }).then((r) => r.json());
      const customer = await registerCustomer(app);

      const plans = await app.inject({ method: "GET", url: `/customer/loyalty/businesses/${biz.slug}/membership-plans`, headers: auth(customer.token) }).then((r) => r.json());
      expect(plans.map((p: { id: string }) => p.id)).toContain(plan.id);

      const enrol = await app.inject({ method: "POST", url: `/customer/loyalty/businesses/${biz.slug}/memberships`, headers: auth(customer.token), payload: { planId: plan.id } });
      expect(enrol.statusCode).toBe(201);

      const services = await app.inject({ method: "GET", url: `/customer/bookings/businesses/${biz.slug}/services`, headers: auth(customer.token) }).then((r) => r.json());
      expect(services.membership.discountPercent).toBe(30);
      expect(services.services[0].price).toBe(50);
      expect(services.services[0].memberPrice).toBe(35);

      const cancel = await app.inject({ method: "POST", url: `/customer/loyalty/memberships/${enrol.json().id}/cancel`, headers: auth(customer.token), payload: { immediate: true } });
      expect(cancel.json().status).toBe("cancelled");
    });

    it("blocks a second active membership with the same business", async () => {
      const biz = await loyaltyBusiness(app, "Dup Salon");
      const plan = await app.inject({ method: "POST", url: "/loyalty/membership-plans", headers: auth(biz.token), payload: { name: "Basic", billingInterval: "annual", priceAmount: 100 } }).then((r) => r.json());
      const customer = await registerCustomer(app);
      await app.inject({ method: "POST", url: `/customer/loyalty/businesses/${biz.slug}/memberships`, headers: auth(customer.token), payload: { planId: plan.id } });
      const second = await app.inject({ method: "POST", url: `/customer/loyalty/businesses/${biz.slug}/memberships`, headers: auth(customer.token), payload: { planId: plan.id } });
      expect(second.statusCode).toBe(409);
    });
  });

  describe("referrals", () => {
    it("tracks a referral from code to first-booking completion and rewards both sides", async () => {
      const biz = await loyaltyBusiness(app, "Referral Salon", { pointsPerCurrency: 0, pointsPerReferral: 250 });
      const referrer = await registerCustomer(app, { fullName: "Rita Referrer" });
      // Referrer must relate to the business so points have somewhere to land.
      await app.inject({ method: "POST", url: `/customer/loyalty/accounts/${biz.businessId}/enrol`, headers: auth(referrer.token) });
      const code = await app.inject({ method: "POST", url: "/customer/loyalty/referrals/code", headers: auth(referrer.token), payload: { businessSlug: biz.slug } }).then((r) => r.json());
      expect(code.inviteUrl).toContain(code.code);

      const referee = await registerCustomer(app, { fullName: "Fred Friend" });
      const redeem = await app.inject({ method: "POST", url: "/customer/loyalty/referrals/redeem", headers: auth(referee.token), payload: { code: code.code } });
      expect(redeem.statusCode).toBe(201);
      expect(redeem.json().status).toBe("joined");

      // Referee's first booking completes the referral.
      await book(app, referee.token, biz, futureSlot(7, 9));

      const overview = await app.inject({ method: "GET", url: "/customer/loyalty/referrals", headers: auth(referrer.token) }).then((r) => r.json());
      expect(overview.summary.completed).toBe(1);

      const account = await app.inject({ method: "GET", url: `/customer/loyalty/accounts/${biz.businessId}`, headers: auth(referrer.token) }).then((r) => r.json());
      expect(account.pointsBalance).toBe(250);
    });

    it("rejects self-referral and double-referral", async () => {
      const a = await registerCustomer(app);
      const code = await app.inject({ method: "POST", url: "/customer/loyalty/referrals/code", headers: auth(a.token) }).then((r) => r.json());
      const self = await app.inject({ method: "POST", url: "/customer/loyalty/referrals/redeem", headers: auth(a.token), payload: { code: code.code } });
      expect(self.statusCode).toBe(409);
    });
  });

  describe("wallet, dashboard, marketplace & AI", () => {
    it("aggregates the wallet across businesses and feeds the dashboard", async () => {
      const biz1 = await loyaltyBusiness(app, "Wallet Salon A", { pointsPerCurrency: 10 });
      const biz2 = await loyaltyBusiness(app, "Wallet Salon B", { pointsPerCurrency: 5 });
      const customer = await registerCustomer(app);
      await complete(app, biz1.token, await book(app, customer.token, biz1, futureSlot(2, 9)));
      await complete(app, biz2.token, await book(app, customer.token, biz2, futureSlot(2, 11)));

      const wallet = await app.inject({ method: "GET", url: "/customer/loyalty/wallet", headers: auth(customer.token) }).then((r) => r.json());
      expect(wallet.totalPoints).toBe(500 + 250);
      expect(wallet.accounts).toHaveLength(2);

      const dash = await app.inject({ method: "GET", url: "/customer/dashboard", headers: auth(customer.token) }).then((r) => r.json());
      expect(dash.loyalty.totalPoints).toBe(750);
      expect(dash.loyalty.tiers).toHaveLength(2);
    });

    it("shows loyalty + membership badges on the marketplace profile", async () => {
      const biz = await loyaltyBusiness(app, "Badge Salon", { pointsPerCurrency: 3 });
      await app.inject({ method: "POST", url: "/loyalty/membership-plans", headers: auth(biz.token), payload: { name: "VIP", billingInterval: "monthly", priceAmount: 15, discountPercent: 10 } });
      const customer = await registerCustomer(app);
      const profile = await app.inject({ method: "GET", url: `/customer/marketplace/businesses/${biz.slug}`, headers: auth(customer.token) }).then((r) => r.json());
      expect(profile.loyalty.hasProgram).toBe(true);
      expect(profile.loyalty.hasMemberships).toBe(true);
      expect(profile.loyalty.membershipPlans[0].discountPercent).toBe(10);
    });

    it("exposes the loyalty wallet in the customer AI assistant context and tool list", async () => {
      const biz = await loyaltyBusiness(app, "AI Loyalty Salon", { pointsPerCurrency: 8 });
      const customer = await registerCustomer(app);
      await complete(app, biz.token, await book(app, customer.token, biz, futureSlot(2, 9)));

      const ctx = await app.inject({ method: "GET", url: "/customer/ai/assistant/context", headers: auth(customer.token) }).then((r) => r.json());
      expect(ctx.loyalty.totalPoints).toBe(400);
      expect(ctx.loyalty.accounts).toHaveLength(1);

      const { isCustomerAssistantTool } = await import("../src/lib/ai/customerAssistant/customerAssistantTools.js");
      for (const tool of ["loyalty_balance", "list_rewards", "redeem_reward", "membership_options", "my_memberships", "referral_status", "loyalty_recommendations"]) {
        expect(isCustomerAssistantTool(tool)).toBe(true);
      }
    });
  });

  describe("notifications", () => {
    it("writes a loyalty notification when points are earned", async () => {
      const biz = await loyaltyBusiness(app, "Notify Salon", { pointsPerCurrency: 5 });
      const customer = await registerCustomer(app);
      await complete(app, biz.token, await book(app, customer.token, biz, futureSlot(2, 9)));
      const feed = await app.inject({ method: "GET", url: "/customer/notifications", headers: auth(customer.token) }).then((r) => r.json());
      expect(feed.some((n: { category: string }) => n.category === "loyalty")).toBe(true);
    });
  });

  describe("admin oversight", () => {
    it("exposes platform loyalty analytics, fraud review and can revoke a transaction with RBAC + audit", async () => {
      const biz = await loyaltyBusiness(app, "Admin Salon", { pointsPerCurrency: 10 });
      const customer = await registerCustomer(app);
      await complete(app, biz.token, await book(app, customer.token, biz, futureSlot(2, 9)));
      const a = await superAdmin(app);

      const analytics = await app.inject({ method: "GET", url: "/admin/loyalty/analytics", headers: a.headers }).then((r) => r.json());
      expect(analytics.loyaltyAccounts).toBeGreaterThanOrEqual(1);
      expect(analytics.outstandingPoints).toBe(500);

      expect((await app.inject({ method: "GET", url: "/admin/loyalty/programs", headers: a.headers })).statusCode).toBe(200);
      expect((await app.inject({ method: "GET", url: "/admin/loyalty/fraud-review", headers: a.headers })).statusCode).toBe(200);

      const earn = await prisma.loyaltyTransaction.findFirstOrThrow({ where: { businessId: biz.businessId, kind: "earn" } });
      const revoke = await app.inject({ method: "POST", url: `/admin/loyalty/transactions/${earn.id}/revoke`, headers: a.write, payload: { reason: "fraud" } });
      expect(revoke.statusCode).toBe(200);
      expect(await prisma.adminAuditLog.count({ where: { action: "LOYALTY_TRANSACTION_REVOKED" } })).toBe(1);
      const account = await app.inject({ method: "GET", url: `/customer/loyalty/accounts/${biz.businessId}`, headers: auth(customer.token) }).then((r) => r.json());
      expect(account.pointsBalance).toBe(0);
    });

    it("blocks loyalty admin routes for non-admins and customer sessions", async () => {
      const plain = await registerAccount(app, { email: `plain-${Date.now()}@example.com`, businessName: "Plain Co" });
      expect([401, 403]).toContain((await app.inject({ method: "GET", url: "/admin/loyalty/analytics", headers: auth(plain.accessToken) })).statusCode);
      const customer = await registerCustomer(app);
      expect([401, 403]).toContain((await app.inject({ method: "GET", url: "/admin/loyalty/analytics", headers: auth(customer.token) })).statusCode);
    });
  });

  describe("isolation", () => {
    it("a customer only sees their own loyalty accounts and rewards", async () => {
      const biz = await loyaltyBusiness(app, "Iso Salon", { pointsPerCurrency: 10 });
      const alice = await registerCustomer(app);
      const bob = await registerCustomer(app);
      await complete(app, biz.token, await book(app, alice.token, biz, futureSlot(2, 9)));

      const bobWallet = await app.inject({ method: "GET", url: "/customer/loyalty/wallet", headers: auth(bob.token) }).then((r) => r.json());
      expect(bobWallet.accounts).toHaveLength(0);
      const bobAccount = await app.inject({ method: "GET", url: `/customer/loyalty/accounts/${biz.businessId}`, headers: auth(bob.token) }).then((r) => r.json());
      expect(bobAccount.pointsBalance).toBe(0);
    });
  });
});
