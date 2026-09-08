import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createSession } from "../src/modules/auth/auth.service.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";
import { expireStaleLocationShares } from "../src/modules/locationShare/locationShare.service.js";

const openEveryDay = { version: 1, days: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(d => [d, { enabled: true, opensAt: "00:00", closesAt: "23:59" }])) };
const cust = (t: string) => ({ authorization: `Bearer ${t}` });
function futureSlot(days = 3, hourUtc = 10) { const d = new Date(Date.now() + days * 86_400_000); d.setUTCHours(hourUtc, 0, 0, 0); return d.toISOString(); }

async function bookableBusiness(app: FastifyInstance, name: string) {
  const account = await registerAccount(app, { businessName: name, email: `${name.replace(/\W/g, "")}-${Date.now()}@ex.com` });
  const business = await prisma.business.update({
    where: { id: account.businessId },
    data: { timezone: "UTC", workingHours: openEveryDay, bookingMinNoticeMinutes: 0, bookingWindowDays: 365, cancellationNoticeMinutes: 0, industry: "hair salon" },
    select: { id: true, publicSlug: true },
  });
  const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: business.id } });
  const service = await prisma.serviceOffering.create({ data: { businessId: business.id, name: "Haircut", durationMinutes: 60, price: 40, publiclyBookable: true } });
  return { ...account, slug: business.publicSlug as string, businessId: business.id, memberId: member.id, serviceId: service.id };
}
async function registerCustomer(app: FastifyInstance) {
  const email = `cust-${Date.now()}-${Math.random().toString(36).slice(2)}@ex.com`;
  const res = await app.inject({ method: "POST", url: "/customer/auth/register", payload: { email, password: "password123", fullName: "Casey Customer" } });
  if (res.statusCode !== 201) throw new Error(res.body);
  return { token: res.json().accessToken as string, profileId: res.json().profile.id as string };
}
async function staffToken(app: FastifyInstance, businessId: string) {
  const email = `staff-${Date.now()}-${Math.random().toString(36).slice(2)}@ex.com`;
  const user = await prisma.user.create({ data: { email, normalizedEmail: email.toLowerCase(), fullName: "Staff", passwordHash: null } });
  await prisma.businessMember.create({ data: { businessId, userId: user.id, role: "STAFF", status: "ACTIVE" } });
  const { session } = await createSession(user.id, prisma);
  return app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 });
}

describe("appointment live-location share", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  /** Owner business + a customer who has booked an appointment assigned to the owner-member, already "On My Way". */
  async function onTheWay(name = "LocBiz") {
    const biz = await bookableBusiness(app, name);
    const customer = await registerCustomer(app);
    const booked = await app.inject({ method: "POST", url: "/customer/bookings", headers: cust(customer.token), payload: { slug: biz.slug, serviceOfferingId: biz.serviceId, startsAt: futureSlot(3), assignedMemberId: biz.memberId } });
    expect(booked.statusCode).toBe(201);
    const appointmentId = booked.json().appointment.id as string;
    const arr = await app.inject({ method: "POST", url: `/appointments/${appointmentId}/arrival`, headers: authHeader(biz.token), payload: { state: "ON_MY_WAY" } });
    expect(arr.statusCode).toBe(200);
    return { biz, customer, appointmentId };
  }
  const start = (token: string, id: string, body: Record<string, unknown> = { latitude: 51.501, longitude: -0.1417, accuracyMeters: 8 }) =>
    app.inject({ method: "POST", url: `/appointments/${id}/location-share`, headers: authHeader(token), payload: body });
  const update = (token: string, id: string, body: Record<string, unknown>) =>
    app.inject({ method: "PUT", url: `/appointments/${id}/location-share`, headers: authHeader(token), payload: body });
  const view = (token: string, id: string) =>
    app.inject({ method: "GET", url: `/customer/bookings/${id}/provider-location`, headers: cust(token) });

  it("provider shares, the appointment's customer sees the latest coarse position", async () => {
    const { biz, customer, appointmentId } = await onTheWay();
    const started = await start(biz.token, appointmentId, { latitude: 51.5012345, longitude: -0.141777, accuracyMeters: 6 });
    expect(started.statusCode).toBe(201);
    expect(started.json().sharing).toBe(true);
    // stored coarse (5 dp)
    expect(started.json().latitude).toBe(51.50123);
    expect(started.json().longitude).toBe(-0.14178);

    const seen = await view(customer.token, appointmentId);
    expect(seen.statusCode).toBe(200);
    expect(seen.json()).toMatchObject({ sharing: true, latitude: 51.50123, accuracyMeters: 6 });
    expect(new Date(seen.json().expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("only the assigned provider may start or update; other members and tenants are refused", async () => {
    const { biz, appointmentId } = await onTheWay("LocBizB");
    const staff = await staffToken(app, biz.businessId); // active member, not assigned
    expect((await start(staff, appointmentId)).statusCode).toBe(403);

    await start(biz.token, appointmentId);
    expect((await update(staff, appointmentId, { latitude: 51.5, longitude: -0.14 })).statusCode).toBe(403);

    const other = await bookableBusiness(app, "OtherBiz");
    expect((await start(other.token, appointmentId)).statusCode).toBe(404); // cross-tenant
  });

  it("will not start unless the provider is On My Way / Running Late", async () => {
    const biz = await bookableBusiness(app, "LocBizC");
    const customer = await registerCustomer(app);
    const booked = await app.inject({ method: "POST", url: "/customer/bookings", headers: cust(customer.token), payload: { slug: biz.slug, serviceOfferingId: biz.serviceId, startsAt: futureSlot(3), assignedMemberId: biz.memberId } });
    const id = booked.json().appointment.id as string;
    expect((await start(biz.token, id)).statusCode).toBe(409); // no arrival state yet

    await app.inject({ method: "POST", url: `/appointments/${id}/arrival`, headers: authHeader(biz.token), payload: { state: "ARRIVED" } });
    expect((await start(biz.token, id)).statusCode).toBe(409); // already arrived
  });

  it("a customer can only see their own appointment's provider (IDOR)", async () => {
    const a = await onTheWay("LocBizD");
    await start(a.biz.token, a.appointmentId);
    const intruder = await registerCustomer(app);
    expect((await view(intruder.token, a.appointmentId)).statusCode).toBe(404);
  });

  it("rate-limits provider position updates to one every few seconds", async () => {
    const { biz, appointmentId } = await onTheWay("LocBizE");
    await start(biz.token, appointmentId);
    // an update within the floor of the last write is throttled...
    expect((await update(biz.token, appointmentId, { latitude: 51.502, longitude: -0.142 })).statusCode).toBe(429);
    // ...simulate a few seconds passing, then one update is accepted and the next is throttled again
    await prisma.appointmentLocationShare.update({ where: { appointmentId }, data: { updatedAt: new Date(Date.now() - 5000) } });
    expect((await update(biz.token, appointmentId, { latitude: 51.502, longitude: -0.142 })).statusCode).toBe(200);
    expect((await update(biz.token, appointmentId, { latitude: 51.503, longitude: -0.143 })).statusCode).toBe(429);
  });

  it("server-side expiry ends sharing even if clients keep polling / pushing", async () => {
    const { biz, customer, appointmentId } = await onTheWay("LocBizF");
    await start(biz.token, appointmentId);
    await prisma.appointmentLocationShare.update({ where: { appointmentId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const seen = await view(customer.token, appointmentId);
    expect(seen.json().sharing).toBe(false);
    expect(await prisma.appointmentLocationShare.findUnique({ where: { appointmentId } })).toBeNull();
    // provider update after expiry is rejected
    expect((await update(biz.token, appointmentId, { latitude: 51.5, longitude: -0.14 })).statusCode).toBe(409);
  });

  it("Arrived / Completed / Canceled / cleared-arrival all terminate sharing server-side", async () => {
    // Arrived
    let s = await onTheWay("LocBizG1");
    await start(s.biz.token, s.appointmentId);
    await app.inject({ method: "POST", url: `/appointments/${s.appointmentId}/arrival`, headers: authHeader(s.biz.token), payload: { state: "ARRIVED" } });
    expect(await prisma.appointmentLocationShare.findUnique({ where: { appointmentId: s.appointmentId } })).toBeNull();

    // Cleared arrival
    s = await onTheWay("LocBizG2");
    await start(s.biz.token, s.appointmentId);
    await app.inject({ method: "DELETE", url: `/appointments/${s.appointmentId}/arrival`, headers: authHeader(s.biz.token) });
    expect(await prisma.appointmentLocationShare.findUnique({ where: { appointmentId: s.appointmentId } })).toBeNull();

    // Completed (needs CONFIRMED first)
    s = await onTheWay("LocBizG3");
    await start(s.biz.token, s.appointmentId);
    await app.inject({ method: "POST", url: `/appointments/${s.appointmentId}/status`, headers: authHeader(s.biz.token), payload: { status: "CONFIRMED" } });
    await app.inject({ method: "POST", url: `/appointments/${s.appointmentId}/status`, headers: authHeader(s.biz.token), payload: { status: "COMPLETED" } });
    expect(await prisma.appointmentLocationShare.findUnique({ where: { appointmentId: s.appointmentId } })).toBeNull();
    // replay after completion
    expect((await update(s.biz.token, s.appointmentId, { latitude: 51.5, longitude: -0.14 })).statusCode).toBe(409);

    // Canceled
    s = await onTheWay("LocBizG4");
    await start(s.biz.token, s.appointmentId);
    await app.inject({ method: "POST", url: `/appointments/${s.appointmentId}/status`, headers: authHeader(s.biz.token), payload: { status: "CANCELED" } });
    expect(await prisma.appointmentLocationShare.findUnique({ where: { appointmentId: s.appointmentId } })).toBeNull();
  });

  it("explicit stop is idempotent, and the sweep clears stragglers", async () => {
    const { biz, appointmentId } = await onTheWay("LocBizH");
    await start(biz.token, appointmentId);
    expect((await app.inject({ method: "DELETE", url: `/appointments/${appointmentId}/location-share`, headers: authHeader(biz.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: `/appointments/${appointmentId}/location-share`, headers: authHeader(biz.token) })).statusCode).toBe(200);

    const b2 = await onTheWay("LocBizI");
    await start(b2.biz.token, b2.appointmentId);
    await prisma.appointmentLocationShare.update({ where: { appointmentId: b2.appointmentId }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    expect(await expireStaleLocationShares(new Date())).toBeGreaterThanOrEqual(1);
    expect(await prisma.appointmentLocationShare.findUnique({ where: { appointmentId: b2.appointmentId } })).toBeNull();
  });
});
