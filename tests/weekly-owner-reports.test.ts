import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { generateDueWeeklyOwnerReports } from "../src/modules/weeklyReports/weeklyReports.service.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

describe("weekly owner reports", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it("generates one deterministic report per local week and delivers it in-app", async () => {
    const account = await registerAccount(app, { email: "weekly-report@example.com" });
    await prisma.business.update({ where: { id: account.businessId }, data: { timezone: "UTC" } });
    const period = new Date("2026-08-24T10:00:00.000Z");
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Weekly Customer", createdAt: new Date("2026-08-20T10:00:00.000Z") } });
    await prisma.appointment.create({ data: { businessId: account.businessId, customerId: customer.id, createdByUserId: account.userId, serviceName: "Service", startsAt: new Date("2026-08-21T09:00:00.000Z"), endsAt: new Date("2026-08-21T10:00:00.000Z"), status: "COMPLETED", price: 80, paidAmount: 80, paymentStatus: "paid", createdAt: new Date("2026-08-20T10:00:00.000Z"), updatedAt: new Date("2026-08-21T10:00:00.000Z") } });
    expect(await generateDueWeeklyOwnerReports(period)).toEqual({ generated: 1 });
    expect(await generateDueWeeklyOwnerReports(period)).toEqual({ generated: 0 });
    const response = await app.inject({ method: "GET", url: "/weekly-reports", headers: authHeader(account.token) });
    expect(response.statusCode).toBe(200);
    expect(response.json()[0].summary).toMatchObject({ appointmentsCompleted: 1, appointmentsBooked: 1, collectedRevenue: 80, newCustomers: 1 });
    expect((await prisma.weeklyOwnerReport.findFirstOrThrow()).viewedAt).not.toBeNull();
  });
});
