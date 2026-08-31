import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { config } from "../src/lib/config.js";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const openEveryDay = { version: 1, days: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, { enabled: true, opensAt: "00:00", closesAt: "23:59" }])) };

/** A whole hour, `days` days out, so it always clears min-notice and sits inside the booking window. */
function futureSlot(days = 7, hourUtc = 10): string {
  const date = new Date(Date.now() + days * 86_400_000);
  date.setUTCHours(hourUtc, 0, 0, 0);
  return date.toISOString();
}

async function registerCustomer(app: FastifyInstance, over: Partial<{ email: string; fullName: string }> = {}) {
  const email = over.email ?? `cust-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName: over.fullName ?? "Casey Customer" } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json();
  return { email, token: body.accessToken as string, profileId: body.profile.id as string, userId: body.user.id as string };
}

async function bookableBusiness(app: FastifyInstance, name: string, over: Partial<{ cancellationNoticeMinutes: number }> = {}) {
  const account = await registerAccount(app, { businessName: name });
  const business = await prisma.business.update({
    where: { id: account.businessId },
    data: { timezone: "UTC", workingHours: openEveryDay, bookingMinNoticeMinutes: 0, bookingWindowDays: 365, cancellationNoticeMinutes: over.cancellationNoticeMinutes ?? 0, defaultAppointmentReminderMinutes: 1440, industry: "hair salon" },
    select: { id: true, publicSlug: true },
  });
  const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: business.id } });
  const service = await prisma.serviceOffering.create({ data: { businessId: business.id, name: "Haircut", durationMinutes: 60, price: 40, publiclyBookable: true } });
  return { ...account, slug: business.publicSlug as string, businessId: business.id, memberId: member.id, serviceId: service.id };
}

async function admin(app: FastifyInstance) {
  const email = `bk-admin-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const account = await registerAccount(app, { email, password: "admin-password-123", businessName: "Admin Co" });
  await prisma.adminMembership.create({ data: { userId: account.userId, role: "SUPER_ADMIN" } });
  const login = await app.inject({ method: "POST", url: "/admin/auth/login", payload: { email, password: "admin-password-123" } });
  const token = login.json().accessToken as string;
  const csrf = login.json().csrfToken as string;
  return { headers: { authorization: `Bearer ${token}` }, write: { authorization: `Bearer ${token}`, origin: "http://localhost:5173", "x-csrf-token": csrf } };
}

async function adminRole(app: FastifyInstance, role: string) {
  const email = `bk-admin-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const account = await registerAccount(app, { email, password: "admin-password-123", businessName: `Role ${role}` });
  await prisma.adminMembership.create({ data: { userId: account.userId, role: role as never } });
  const login = await app.inject({ method: "POST", url: "/admin/auth/login", payload: { email, password: "admin-password-123" } });
  const token = login.json().accessToken as string;
  const csrf = login.json().csrfToken as string;
  return { headers: { authorization: `Bearer ${token}` }, write: { authorization: `Bearer ${token}`, origin: "http://localhost:5173", "x-csrf-token": csrf } };
}

async function book(app: FastifyInstance, token: string, biz: { slug: string; serviceId: string }, startsAt: string, memberId?: string) {
  return app.inject({ method: "POST", url: "/customer/bookings", headers: auth(token), payload: { slug: biz.slug, serviceOfferingId: biz.serviceId, startsAt, ...(memberId ? { assignedMemberId: memberId } : {}) } });
}

describe("Customer Booking & Calendar Platform (Program 2, Loop 3)", () => {
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

  describe("booking flow", () => {
    it("lists bookable services and live availability, then books an appointment", async () => {
      const biz = await bookableBusiness(app, "Flow Salon");
      const customer = await registerCustomer(app);
      const startsAt = futureSlot();

      const services = await app.inject({ method: "GET", url: `/customer/bookings/businesses/${biz.slug}/services`, headers: auth(customer.token) }).then((r) => r.json());
      expect(services.services.map((s: { name: string }) => s.name)).toEqual(["Haircut"]);

      const from = new Date(new Date(startsAt).getTime() - 3_600_000).toISOString();
      const to = new Date(new Date(startsAt).getTime() + 3_600_000).toISOString();
      const availability = await app.inject({ method: "GET", url: `/customer/bookings/businesses/${biz.slug}/availability?serviceOfferingId=${biz.serviceId}&from=${from}&to=${to}`, headers: auth(customer.token) }).then((r) => r.json());
      expect(availability.slots.some((slot: { startsAt: string }) => slot.startsAt === startsAt)).toBe(true);

      const res = await book(app, customer.token, biz, startsAt);
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.appointment.serviceName).toBe("Haircut");
      expect(body.appointment.bookingChannel).toBe("customer_app");
      expect(body.appointment.bookedByCustomerProfileId).toBe(customer.profileId);
      expect(body.receipt).toMatchObject({ businessName: "Flow Salon", service: "Haircut", currency: null });
      expect(body.receipt.reference).toHaveLength(8);

      // no payment surface in this loop
      expect(body).not.toHaveProperty("checkoutUrl");
      expect(body.receipt).not.toHaveProperty("paymentLink");
    });

    it("auto-assigns an available staff member when none is chosen", async () => {
      const biz = await bookableBusiness(app, "AutoStaff Salon");
      const customer = await registerCustomer(app);
      const res = await book(app, customer.token, biz, futureSlot(8));
      expect(res.statusCode).toBe(201);
      const stored = await prisma.appointment.findFirstOrThrow({ where: { bookedByCustomerProfileId: customer.profileId } });
      expect(stored.assignedMemberId).toBe(biz.memberId);
    });

    it("prevents double-booking the same slot (reuses the appointment conflict engine)", async () => {
      const biz = await bookableBusiness(app, "Conflict Salon");
      const a = await registerCustomer(app);
      const b = await registerCustomer(app);
      const startsAt = futureSlot(9);
      expect((await book(app, a.token, biz, startsAt, biz.memberId)).statusCode).toBe(201);
      const clash = await book(app, b.token, biz, startsAt, biz.memberId);
      expect(clash.statusCode).toBe(409);
    });

    it("requires a customer session", async () => {
      const biz = await bookableBusiness(app, "Guarded Salon");
      const res = await app.inject({ method: "POST", url: "/customer/bookings", payload: { slug: biz.slug, serviceOfferingId: biz.serviceId, startsAt: futureSlot() } });
      expect([401, 403]).toContain(res.statusCode);
    });
  });

  describe("customer calendar", () => {
    it("returns upcoming and past bookings and an ICS export", async () => {
      const biz = await bookableBusiness(app, "Calendar Salon");
      const customer = await registerCustomer(app);
      const upcomingRes = await book(app, customer.token, biz, futureSlot(10));
      const apptId = upcomingRes.json().appointment.id;
      // a completed past appointment on the same linked customer row
      const link = await prisma.customerBusinessLink.findFirstOrThrow({ where: { customerProfileId: customer.profileId, businessId: biz.businessId } });
      await prisma.appointment.create({ data: { businessId: biz.businessId, customerId: link.businessCustomerId, assignedMemberId: biz.memberId, serviceOfferingId: biz.serviceId, serviceName: "Haircut", startsAt: new Date(Date.now() - 14 * 86_400_000), endsAt: new Date(Date.now() - 14 * 86_400_000 + 3_600_000), status: "COMPLETED", createdByUserId: customer.userId, bookedByCustomerProfileId: customer.profileId, bookingChannel: "customer_app" } });

      const upcoming = await app.inject({ method: "GET", url: "/customer/bookings?scope=upcoming", headers: auth(customer.token) }).then((r) => r.json());
      expect(upcoming.map((bkg: { id: string }) => bkg.id)).toEqual([apptId]);
      expect(upcoming[0].canCancel).toBe(true);

      const past = await app.inject({ method: "GET", url: "/customer/bookings?scope=past", headers: auth(customer.token) }).then((r) => r.json());
      expect(past.every((bkg: { status: string }) => bkg.status === "COMPLETED")).toBe(true);

      const ics = await app.inject({ method: "GET", url: `/customer/bookings/${apptId}/calendar.ics`, headers: auth(customer.token) });
      expect(ics.headers["content-type"]).toContain("text/calendar");
      expect(ics.body).toContain("BEGIN:VEVENT");
    });

    it("only ever shows the customer their own bookings", async () => {
      const biz = await bookableBusiness(app, "Isolation Salon");
      const a = await registerCustomer(app);
      const b = await registerCustomer(app);
      const res = await book(app, a.token, biz, futureSlot(11));
      const list = await app.inject({ method: "GET", url: "/customer/bookings", headers: auth(b.token) }).then((r) => r.json());
      expect(list).toHaveLength(0);
      const denied = await app.inject({ method: "GET", url: `/customer/bookings/${res.json().appointment.id}`, headers: auth(b.token) });
      expect(denied.statusCode).toBe(404);
    });
  });

  describe("reschedule & cancel", () => {
    it("reschedules an open booking and resets reminder flags", async () => {
      const biz = await bookableBusiness(app, "Reschedule Salon");
      const customer = await registerCustomer(app);
      const created = await book(app, customer.token, biz, futureSlot(12, 9));
      const id = created.json().appointment.id;
      const moved = await app.inject({ method: "PATCH", url: `/customer/bookings/${id}/reschedule`, headers: auth(customer.token), payload: { startsAt: futureSlot(12, 14) } });
      expect(moved.statusCode).toBe(200);
      expect(new Date(moved.json().startsAt).getUTCHours()).toBe(14);
      const stored = await prisma.appointment.findUniqueOrThrow({ where: { id } });
      expect(stored.customerReminderSentAt).toBeNull();
      expect(await prisma.customerActivityEvent.count({ where: { customerProfileId: customer.profileId, type: "BOOKING_RESCHEDULED" } })).toBe(1);
    });

    it("cancels an open booking", async () => {
      const biz = await bookableBusiness(app, "Cancel Salon");
      const customer = await registerCustomer(app);
      const created = await book(app, customer.token, biz, futureSlot(13));
      const cancelled = await app.inject({ method: "POST", url: `/customer/bookings/${created.json().appointment.id}/cancel`, headers: auth(customer.token) });
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json().status).toBe("CANCELED");
    });

    it("refuses to cancel inside the cancellation-notice window", async () => {
      const biz = await bookableBusiness(app, "Notice Salon", { cancellationNoticeMinutes: 100_000 });
      const customer = await registerCustomer(app);
      const created = await book(app, customer.token, biz, futureSlot(2));
      const blocked = await app.inject({ method: "POST", url: `/customer/bookings/${created.json().appointment.id}/cancel`, headers: auth(customer.token) });
      expect(blocked.statusCode).toBe(409);
    });
  });

  describe("notifications & AI", () => {
    it("writes a booking_update notification to the customer feed on booking", async () => {
      const biz = await bookableBusiness(app, "Notify Salon");
      const customer = await registerCustomer(app);
      await book(app, customer.token, biz, futureSlot(14));
      const feed = await app.inject({ method: "GET", url: "/customer/notifications", headers: auth(customer.token) }).then((r) => r.json());
      expect(feed.some((n: { category: string; title: string }) => n.category === "booking_update" && n.title === "Booking confirmed")).toBe(true);
    });

    it("surfaces bookings and rebooking recommendations in the customer AI context", async () => {
      const biz = await bookableBusiness(app, "AI Salon");
      const customer = await registerCustomer(app);
      await book(app, customer.token, biz, futureSlot(15));
      const link = await prisma.customerBusinessLink.findFirstOrThrow({ where: { customerProfileId: customer.profileId, businessId: biz.businessId } });
      // two completed visits ~30 days apart so a cadence is derivable
      for (const daysAgo of [70, 35]) {
        await prisma.appointment.create({ data: { businessId: biz.businessId, customerId: link.businessCustomerId, serviceOfferingId: biz.serviceId, serviceName: "Haircut", startsAt: new Date(Date.now() - daysAgo * 86_400_000), endsAt: new Date(Date.now() - daysAgo * 86_400_000 + 3_600_000), status: "COMPLETED", createdByUserId: customer.userId, bookedByCustomerProfileId: customer.profileId, bookingChannel: "customer_app" } });
      }
      const ctx = await app.inject({ method: "GET", url: "/customer/ai/context", headers: auth(customer.token) }).then((r) => r.json());
      expect(ctx.bookings.upcoming.length).toBe(1);
      expect(ctx.bookings.historyCount).toBe(2);
      expect(ctx.bookings.recommendations.some((rec: { serviceName: string }) => rec.serviceName === "Haircut")).toBe(true);
    });
  });

  describe("admin oversight", () => {
    it("lists bookings, analytics, detail with audit trail, and manual adjustments with RBAC + audit", async () => {
      const biz = await bookableBusiness(app, "Oversight Salon");
      const customer = await registerCustomer(app);
      const created = await book(app, customer.token, biz, futureSlot(16, 9));
      const id = created.json().appointment.id;
      const a = await admin(app);

      const list = await app.inject({ method: "GET", url: `/admin/bookings?businessId=${biz.businessId}`, headers: a.headers });
      expect(list.statusCode).toBe(200);
      expect(list.json().items.some((row: { id: string; bookingChannel: string }) => row.id === id && row.bookingChannel === "customer_app")).toBe(true);

      const analytics = await app.inject({ method: "GET", url: "/admin/bookings/analytics", headers: a.headers }).then((r) => r.json());
      expect(analytics.total).toBeGreaterThanOrEqual(1);
      expect(analytics.byChannel.customer_app).toBeGreaterThanOrEqual(1);
      expect(analytics).toHaveProperty("cancellationRate");

      const detail = await app.inject({ method: "GET", url: `/admin/bookings/${id}`, headers: a.headers }).then((r) => r.json());
      expect(detail.bookedByCustomer.name).toBe("Casey Customer");
      expect(Array.isArray(detail.auditTrail)).toBe(true);
      expect(detail.auditTrail.some((entry: { eventType: string }) => entry.eventType === "APPOINTMENT_CREATED")).toBe(true);

      const moved = await app.inject({ method: "PATCH", url: `/admin/bookings/${id}/reschedule`, headers: a.write, payload: { startsAt: futureSlot(16, 15), reason: "customer phoned in" } });
      expect(moved.statusCode).toBe(200);
      expect(await prisma.adminAuditLog.count({ where: { action: "BOOKING_RESCHEDULED", targetId: id } })).toBe(1);

      const status = await app.inject({ method: "POST", url: `/admin/bookings/${id}/status`, headers: a.write, payload: { status: "CONFIRMED" } });
      expect(status.statusCode).toBe(200);
      expect(await prisma.adminAuditLog.count({ where: { action: "BOOKING_STATUS_CHANGED", targetId: id } })).toBe(1);
    });

    it("enforces booking.manage — a READ_ONLY admin can read but not adjust", async () => {
      const biz = await bookableBusiness(app, "RBAC Salon");
      const customer = await registerCustomer(app);
      const created = await book(app, customer.token, biz, futureSlot(17));
      const ro = await adminRole(app, "READ_ONLY");

      expect((await app.inject({ method: "GET", url: "/admin/bookings", headers: ro.headers })).statusCode).toBe(200);
      const denied = await app.inject({ method: "POST", url: `/admin/bookings/${created.json().appointment.id}/status`, headers: ro.write, payload: { status: "CONFIRMED" } });
      expect(denied.statusCode).toBe(403);
    });
  });
});
