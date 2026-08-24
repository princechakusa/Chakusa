import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const openEveryDay = { version: 1, days: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, { enabled: true, opensAt: "00:00", closesAt: "23:59" }])) };

describe("public appointment booking", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("exposes only active public services and books an available slot", async () => {
    const account = await registerAccount(app, { businessName: "Bookable Studio" });
    const business = await prisma.business.update({ where: { id: account.businessId }, data: { timezone: "UTC", workingHours: openEveryDay, bookingMinNoticeMinutes: 0, bookingWindowDays: 365, cancellationNoticeMinutes: 0 } });
    const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: business.id } });
    const service = await prisma.serviceOffering.create({ data: { businessId: business.id, name: "Consultation", durationMinutes: 45, price: 50, publiclyBookable: true } });
    await prisma.serviceOffering.create({ data: { businessId: business.id, name: "Internal", durationMinutes: 30, publiclyBookable: false } });

    const profile = await app.inject({ method: "GET", url: `/public/business/${business.publicSlug}` });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().services.map((item: { name: string }) => item.name)).toEqual(["Consultation"]);

    const startsAt = "2026-08-31T09:00:00.000Z";
    const booking = await app.inject({ method: "POST", url: `/public/business/${business.publicSlug}/book`, payload: { serviceOfferingId: service.id, assignedMemberId: member.id, startsAt, name: "Public Customer", phone: "+15551234567", email: "customer@example.com" } });
    expect(booking.statusCode).toBe(201);
    expect(booking.json()).toMatchObject({ businessName: "Bookable Studio", appointment: { serviceName: "Consultation", startsAt } });
    expect(booking.json().managementToken).toContain(".");
    const stored = await prisma.appointment.findFirstOrThrow({ where: { businessId: business.id } });
    expect(stored.endsAt.toISOString()).toBe("2026-08-31T09:45:00.000Z");
    expect(await prisma.publicBookingAccess.count({ where: { appointmentId: stored.id } })).toBe(1);
  });

  it("rejects double booking and allows cancellation only with the opaque management token", async () => {
    const account = await registerAccount(app, { businessName: "Secure Booking" });
    const business = await prisma.business.update({ where: { id: account.businessId }, data: { timezone: "UTC", workingHours: openEveryDay, bookingMinNoticeMinutes: 0, bookingWindowDays: 365, cancellationNoticeMinutes: 0 } });
    const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: business.id } });
    const service = await prisma.serviceOffering.create({ data: { businessId: business.id, name: "Session", durationMinutes: 60 } });
    const payload = { serviceOfferingId: service.id, assignedMemberId: member.id, startsAt: "2026-08-31T10:00:00.000Z", name: "Customer", phone: "+15550000000" };
    const first = await app.inject({ method: "POST", url: `/public/business/${business.publicSlug}/book`, payload });
    const duplicate = await app.inject({ method: "POST", url: `/public/business/${business.publicSlug}/book`, payload: { ...payload, phone: "+15550000001" } });
    expect(duplicate.statusCode).toBe(409);
    const invalid = await app.inject({ method: "POST", url: `/public/business/${business.publicSlug}/bookings/not-a-token/cancel` });
    expect(invalid.statusCode).toBe(404);
    const canceled = await app.inject({ method: "POST", url: `/public/business/${business.publicSlug}/bookings/${encodeURIComponent(first.json().managementToken)}/cancel` });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json().status).toBe("CANCELED");
  });
});
