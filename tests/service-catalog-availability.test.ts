import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { calculateAvailability } from "../src/modules/availability/availability.service.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

const mondayHours = { version: 1, days: {
  monday: { enabled: true, opensAt: "09:00", closesAt: "14:00" },
  tuesday: { enabled: false, opensAt: "09:00", closesAt: "17:00" }, wednesday: { enabled: false, opensAt: "09:00", closesAt: "17:00" },
  thursday: { enabled: false, opensAt: "09:00", closesAt: "17:00" }, friday: { enabled: false, opensAt: "09:00", closesAt: "17:00" },
  saturday: { enabled: false, opensAt: "09:00", closesAt: "17:00" }, sunday: { enabled: false, opensAt: "09:00", closesAt: "17:00" },
} };

describe("service catalog and availability", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("persists structured services and keeps legacy service names compatible", async () => {
    const account = await registerAccount(app, { email: "service-owner@example.com" });
    const created = await app.inject({ method: "POST", url: "/services", headers: authHeader(account.token), payload: { name: "Haircut", durationMinutes: 45, price: 35, depositAmount: 10, preparationMinutes: 5, cleanupMinutes: 10 } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: "Haircut", durationMinutes: 45, price: "35", depositAmount: "10", active: true, publiclyBookable: true });
    const listed = await app.inject({ method: "GET", url: "/services?active=true", headers: authHeader(account.token) });
    expect(listed.json()).toHaveLength(1);
    expect((await prisma.business.findUniqueOrThrow({ where: { id: account.businessId } })).defaultServices).toEqual(["Haircut"]);
  });

  it("rejects service assignments to a member of another business", async () => {
    const owner = await registerAccount(app, { email: "service-first@example.com" });
    const other = await registerAccount(app, { email: "service-other@example.com" });
    const foreignMember = await prisma.businessMember.findFirstOrThrow({ where: { businessId: other.businessId } });
    const response = await app.inject({ method: "POST", url: "/services", headers: authHeader(owner.token), payload: { name: "Massage", durationMinutes: 60, memberIds: [foreignMember.id] } });
    expect(response.statusCode).toBe(400);
  });

  it("calculates deterministic slots from hours, service length, blocks, and appointments", async () => {
    const account = await registerAccount(app, { email: "availability@example.com" });
    await prisma.business.update({ where: { id: account.businessId }, data: { timezone: "UTC", workingHours: mondayHours, bookingMinNoticeMinutes: 0, bookingWindowDays: 365, slotIntervalMinutes: 30 } });
    const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: account.businessId } });
    const service = await prisma.serviceOffering.create({ data: { businessId: account.businessId, name: "Cut", durationMinutes: 60 } });
    await prisma.bookingBlock.create({ data: { businessId: account.businessId, assignedMemberId: member.id, startsAt: new Date("2026-08-31T10:00:00.000Z"), endsAt: new Date("2026-08-31T11:00:00.000Z"), createdByUserId: account.userId } });
    await prisma.appointment.create({ data: { businessId: account.businessId, assignedMemberId: member.id, serviceOfferingId: service.id, serviceName: "Cut", startsAt: new Date("2026-08-31T11:30:00.000Z"), endsAt: new Date("2026-08-31T12:30:00.000Z"), createdByUserId: account.userId } });
    const slots = await calculateAvailability(account.businessId, { serviceOfferingId: service.id, from: "2026-08-31T09:00:00.000Z", to: "2026-08-31T14:00:00.000Z" }, new Date("2026-08-30T00:00:00.000Z"));
    expect(slots.map(slot => slot.startsAt)).toEqual(["2026-08-31T09:00:00.000Z", "2026-08-31T12:30:00.000Z", "2026-08-31T13:00:00.000Z"]);
    expect(slots[0]?.members).toEqual([{ id: member.id, name: "Test User" }]);
  });

  it("prevents appointments from crossing preparation, cleanup, or blocked time", async () => {
    const account = await registerAccount(app, { email: "buffer-conflict@example.com" });
    const member = await prisma.businessMember.findFirstOrThrow({ where: { businessId: account.businessId } });
    const service = await prisma.serviceOffering.create({ data: { businessId: account.businessId, name: "Color", durationMinutes: 60, preparationMinutes: 15, cleanupMinutes: 15 } });
    await prisma.bookingBlock.create({ data: { businessId: account.businessId, assignedMemberId: member.id, startsAt: new Date("2026-09-01T08:45:00.000Z"), endsAt: new Date("2026-09-01T09:00:00.000Z"), createdByUserId: account.userId } });
    const blocked = await app.inject({ method: "POST", url: "/appointments", headers: authHeader(account.token), payload: { assignedMemberId: member.id, serviceOfferingId: service.id, serviceName: "Color", startsAt: "2026-09-01T09:00:00.000Z", endsAt: "2026-09-01T10:00:00.000Z" } });
    expect(blocked.statusCode).toBe(409);
  });
});
