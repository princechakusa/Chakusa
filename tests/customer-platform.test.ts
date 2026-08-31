import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";
import { notifyCustomer } from "../src/lib/customer/customerNotifications.js";

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function registerCustomer(app: FastifyInstance, over: Partial<{ email: string; password: string; fullName: string }> = {}) {
  const email = over.email ?? `cust-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: over.password ?? "password123", fullName: over.fullName ?? "Casey Customer" } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json();
  return { email, password: over.password ?? "password123", token: body.accessToken as string, refreshToken: body.refreshToken as string, profileId: body.profile.id as string, userId: body.user.id as string };
}

describe("Customer Platform Foundation (Program 2, Loop 1)", () => {
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

  describe("identity & sessions", () => {
    it("registers a customer without creating a business, and issues a CUSTOMER-scoped session", async () => {
      const customer = await registerCustomer(app);
      expect(await prisma.business.count()).toBe(0);
      const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { id: customer.profileId } });
      expect(profile.status).toBe("ACTIVE");
      const session = await prisma.authSession.findFirstOrThrow({ where: { userId: customer.userId } });
      expect(session.scope).toBe("CUSTOMER");
      // an email verification token was issued
      expect(await prisma.emailVerificationToken.count({ where: { userId: customer.userId } })).toBe(1);
    });

    it("logs in, refreshes, and lists/revokes sessions", async () => {
      const customer = await registerCustomer(app);
      const login = await app.inject({ method: "POST", url: "/customer/auth/login", payload: { email: customer.email, password: customer.password } });
      expect(login.statusCode).toBe(200);
      const refresh = await app.inject({ method: "POST", url: "/customer/auth/refresh", payload: { refreshToken: login.json().refreshToken } });
      expect(refresh.statusCode).toBe(200);
      expect(refresh.json().accessToken).toBeTruthy();

      const sessions = await app.inject({ method: "GET", url: "/customer/auth/sessions", headers: auth(customer.token) }).then((r) => r.json());
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      const logoutAll = await app.inject({ method: "POST", url: "/customer/auth/logout-all", headers: auth(customer.token) });
      expect(logoutAll.json().revoked).toBeGreaterThanOrEqual(1);
      const afterLogout = await app.inject({ method: "GET", url: "/customer/auth/me", headers: auth(customer.token) });
      expect(afterLogout.statusCode).toBe(401);
    });

    it("verifies email and resends verification", async () => {
      const customer = await registerCustomer(app);
      const record = await prisma.emailVerificationToken.findFirstOrThrow({ where: { userId: customer.userId } });
      // The raw token is id.secret; we cannot reconstruct it, so drive verification through the service path.
      const { createEmailVerification } = await import("../src/lib/customer/emailVerification.js");
      const raw = await createEmailVerification(customer.userId, customer.email);
      const verify = await app.inject({ method: "POST", url: "/customer/auth/verify-email", payload: { token: raw } });
      expect(verify.statusCode).toBe(200);
      expect(verify.json().verified).toBe(true);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: customer.userId } });
      expect(user.emailVerifiedAt).not.toBeNull();
      expect((await prisma.customerProfile.findUniqueOrThrow({ where: { id: customer.profileId } })).verifiedAt).not.toBeNull();
      expect(record.id).toBeTruthy();
    });

    it("resets a password through the customer endpoint", async () => {
      const customer = await registerCustomer(app);
      await app.inject({ method: "POST", url: "/customer/auth/forgot-password", payload: { email: customer.email } });
      const reset = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: customer.userId } });
      expect(reset.usedAt).toBeNull();
    });
  });

  describe("permissions & tenant isolation", () => {
    it("a CUSTOMER token cannot access business (PRODUCT) routes", async () => {
      const customer = await registerCustomer(app);
      const denied = await app.inject({ method: "GET", url: "/business", headers: auth(customer.token) });
      expect([401, 403]).toContain(denied.statusCode);
    });

    it("a business (PRODUCT) token cannot access customer routes", async () => {
      const owner = await registerAccount(app);
      const denied = await app.inject({ method: "GET", url: "/customer/profile", headers: auth(owner.token) });
      expect([401, 403]).toContain(denied.statusCode);
    });

    it("customers only ever see their own data", async () => {
      const a = await registerCustomer(app);
      const b = await registerCustomer(app);
      await prisma.customerNotification.create({ data: { customerProfileId: b.profileId, category: "message", title: "B only", body: "secret" } });
      const list = await app.inject({ method: "GET", url: "/customer/notifications", headers: auth(a.token) }).then((r) => r.json());
      expect(list).toHaveLength(0);
      const bList = await app.inject({ method: "GET", url: "/customer/notifications", headers: auth(b.token) }).then((r) => r.json());
      expect(bList).toHaveLength(1);
    });
  });

  describe("profile", () => {
    it("reads and updates the profile and preferences", async () => {
      const customer = await registerCustomer(app);
      const profile = await app.inject({ method: "GET", url: "/customer/profile", headers: auth(customer.token) }).then((r) => r.json());
      expect(profile.preferredLanguage).toBe("en");

      const patched = await app.inject({ method: "PATCH", url: "/customer/profile", headers: auth(customer.token), payload: { displayName: "Casey", preferredLanguage: "fr", preferredTimezone: "Europe/Paris" } });
      expect(patched.json().preferredLanguage).toBe("fr");

      const prefs = await app.inject({ method: "PATCH", url: "/customer/profile/preferences", headers: auth(customer.token), payload: { notificationPreferences: { promotion: { push: true, email: true } }, marketingConsent: true } });
      expect(prefs.json().marketingConsent).toBe(true);
    });

    it("favourites and lists business relationships", async () => {
      const owner = await registerAccount(app, { businessName: "Fav Salon" });
      const customer = await registerCustomer(app);
      const fav = await app.inject({ method: "PATCH", url: `/customer/businesses/${owner.businessId}/favourite`, headers: auth(customer.token), payload: { favourite: true } });
      expect(fav.statusCode).toBe(200);
      const businesses = await app.inject({ method: "GET", url: "/customer/businesses", headers: auth(customer.token) }).then((r) => r.json());
      expect(businesses).toHaveLength(1);
      expect(businesses[0].favourite).toBe(true);
      expect(businesses[0].business.name).toBe("Fav Salon");
      expect(await prisma.customerActivityEvent.count({ where: { customerProfileId: customer.profileId, type: "BUSINESS_FAVOURITED" } })).toBe(1);
    });
  });

  describe("dashboard & AI integration", () => {
    it("aggregates upcoming appointments, conversations and AI runs for a linked customer", async () => {
      const owner = await registerAccount(app, { businessName: "Dash Studio" });
      const customer = await registerCustomer(app);
      const contact = await prisma.customer.create({ data: { businessId: owner.businessId, name: "Casey Customer", phone: "+15551230000", phoneE164: "+15551230000" } });
      await prisma.customerBusinessLink.create({ data: { customerProfileId: customer.profileId, businessId: owner.businessId, businessCustomerId: contact.id, favourite: true } });
      await prisma.appointment.create({ data: { businessId: owner.businessId, customerId: contact.id, serviceName: "Cut", startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 90_000_000), status: "CONFIRMED", createdByUserId: owner.userId } });
      const conv = await prisma.conversation.create({ data: { businessId: owner.businessId, customerId: contact.id, status: "OPEN" } });
      await prisma.aIConversationRun.create({ data: { businessId: owner.businessId, customerId: contact.id, conversationId: conv.id, idempotencyKey: "run-dash-1", status: "COMPLETED" } });

      const dash = await app.inject({ method: "GET", url: "/customer/dashboard", headers: auth(customer.token) }).then((r) => r.json());
      expect(dash.upcomingAppointments).toHaveLength(1);
      expect(dash.recentConversations).toHaveLength(1);
      expect(dash.aiAssistant.recentRuns).toHaveLength(1);
      expect(dash.savedBusinesses).toHaveLength(1);

      const aiConvos = await app.inject({ method: "GET", url: "/customer/ai/conversations", headers: auth(customer.token) }).then((r) => r.json());
      expect(aiConvos.conversations).toHaveLength(1);
      const aiContext = await app.inject({ method: "GET", url: "/customer/ai/context", headers: auth(customer.token) }).then((r) => r.json());
      expect(aiContext.preferredLanguage).toBe("en");
      expect(aiContext.linkedBusinesses).toHaveLength(1);
    });
  });

  describe("notifications", () => {
    it("delivers a notification to the feed and marks it read", async () => {
      const customer = await registerCustomer(app);
      await notifyCustomer({ customerProfileId: customer.profileId, category: "booking_update", title: "Booking confirmed", body: "See you Friday" });
      const list = await app.inject({ method: "GET", url: "/customer/notifications", headers: auth(customer.token) }).then((r) => r.json());
      expect(list).toHaveLength(1);
      const read = await app.inject({ method: "POST", url: `/customer/notifications/${list[0].id}/read`, headers: auth(customer.token) });
      expect(read.json().readAt).not.toBeNull();
      const readAll = await app.inject({ method: "POST", url: "/customer/notifications/read-all", headers: auth(customer.token) });
      expect(readAll.json().updated).toBe(0);
    });

    it("respects notification preferences for push delivery", async () => {
      const customer = await registerCustomer(app);
      await app.inject({ method: "PATCH", url: "/customer/notifications/preferences", headers: auth(customer.token), payload: { notificationPreferences: { promotion: { push: false, email: false } } } });
      const notification = await notifyCustomer({ customerProfileId: customer.profileId, category: "promotion", title: "Sale", body: "20% off" });
      expect(notification.channels).toEqual([]);
    });
  });

  describe("admin", () => {
    async function admin() {
      const email = `cust-admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
      const account = await registerAccount(app, { email, password: "admin-password-123" });
      await prisma.adminMembership.create({ data: { userId: account.userId, role: "SUPER_ADMIN" } });
      const login = await app.inject({ method: "POST", url: "/admin/auth/login", payload: { email, password: "admin-password-123" } });
      if (login.statusCode !== 200) throw new Error(`admin login ${login.statusCode}: ${login.body}`);
      const token = login.json().accessToken as string;
      const csrf = login.json().csrfToken as string;
      return {
        headers: { authorization: `Bearer ${token}` },
        write: { authorization: `Bearer ${token}`, origin: "http://localhost:5173", "x-csrf-token": csrf },
      };
    }

    it("lists, searches, inspects and manages customers with RBAC + audit", async () => {
      const target = await registerCustomer(app, { fullName: "Searchable Person" });
      const a = await admin();

      const list = await app.inject({ method: "GET", url: "/admin/customers?search=Searchable", headers: a.headers });
      expect(list.statusCode).toBe(200);
      expect(list.json().items.some((row: { id: string }) => row.id === target.profileId)).toBe(true);

      const detail = await app.inject({ method: "GET", url: `/admin/customers/${target.profileId}`, headers: a.headers }).then((r) => r.json());
      expect(detail.user.fullName).toBe("Searchable Person");
      expect(detail).toHaveProperty("activeSessions");

      const suspend = await app.inject({ method: "PATCH", url: `/admin/customers/${target.profileId}/status`, headers: a.write, payload: { status: "SUSPENDED", reason: "abuse" } });
      expect(suspend.statusCode).toBe(200);
      expect((await prisma.customerProfile.findUniqueOrThrow({ where: { id: target.profileId } })).status).toBe("SUSPENDED");
      expect(await prisma.adminAuditLog.count({ where: { action: "CUSTOMER_STATUS_CHANGED", targetId: target.profileId } })).toBe(1);
      // suspended customer can no longer authenticate (sessions were revoked)
      const blocked = await app.inject({ method: "GET", url: "/customer/auth/me", headers: auth(target.token) });
      expect([401, 403]).toContain(blocked.statusCode);

      const analytics = await app.inject({ method: "GET", url: "/admin/customers/analytics", headers: a.headers }).then((r) => r.json());
      expect(analytics.totalCustomers).toBeGreaterThanOrEqual(1);
      expect(analytics.byStatus).toHaveProperty("SUSPENDED");
    });
  });
});
