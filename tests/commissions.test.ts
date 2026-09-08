import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan } from "./helpers.js";
import { computeCommissionReport } from "../src/lib/commissions/commissions.domain.js";

describe("commissions domain", () => {
  it("computes percentage, fixed, base-rule fallback and flags mismatches", () => {
    const report = computeCommissionReport({
      members: [{ businessMemberId: "m1", name: "Alex" }, { businessMemberId: "m2", name: "Bo" }],
      rules: [
        { businessMemberId: "m1", serviceOfferingId: "svcA", basis: "PERCENT_OF_SERVICE_PRICE", ratePercent: 20, fixedAmount: null, fixedCurrency: null, active: true },
        { businessMemberId: "m1", serviceOfferingId: null, basis: "PERCENT_OF_SERVICE_PRICE", ratePercent: 10, fixedAmount: null, fixedCurrency: null, active: true },
        { businessMemberId: "m2", serviceOfferingId: null, basis: "FIXED_PER_APPOINTMENT", ratePercent: null, fixedAmount: 15, fixedCurrency: "USD", active: true },
      ],
      appointments: [
        { id: "a1", assignedMemberId: "m1", serviceOfferingId: "svcA", price: 100, currency: "USD" }, // 20%
        { id: "a2", assignedMemberId: "m1", serviceOfferingId: "svcB", price: 50, currency: "USD" },  // base 10%
        { id: "a3", assignedMemberId: "m2", serviceOfferingId: "svcA", price: 80, currency: "USD" },  // fixed 15
        { id: "a4", assignedMemberId: "m2", serviceOfferingId: "svcA", price: 80, currency: "EUR" },  // currency mismatch
        { id: "a5", assignedMemberId: "unknown", serviceOfferingId: "svcA", price: 80, currency: "USD" }, // no rule
      ],
    });
    const alex = report.members.find(m => m.businessMemberId === "m1")!;
    expect(alex.currencies[0]).toMatchObject({ currency: "USD", appointmentCount: 2, serviceRevenue: "150.00", commission: "25.00" });
    const bo = report.members.find(m => m.businessMemberId === "m2")!;
    expect(bo.currencies[0]).toMatchObject({ appointmentCount: 1, commission: "15.00" });
    expect(report.currencyMismatches).toBe(1);
    expect(report.appointmentsWithoutRule).toBe(1);
  });
});

describe("commissions API", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  afterEach(resetDatabase);
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  async function fixture(email = "commissions@example.com") {
    const account = await registerAccount(app, { email });
    await setPlan(account.businessId, "BUSINESS");
    const owner = await prisma.businessMember.findFirstOrThrow({ where: { businessId: account.businessId, userId: account.userId } });
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Pat" } });
    return { ...account, owner, customer };
  }

  it("creates and lists a rule, and upserting the same target updates in place", async () => {
    const account = await fixture();
    const headers = authHeader(account.token);

    const first = await app.inject({ method: "PUT", url: "/commissions/rules", headers, payload: { businessMemberId: account.owner.id, basis: "PERCENT_OF_SERVICE_PRICE", ratePercent: 15 } });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ basis: "PERCENT_OF_SERVICE_PRICE", ratePercent: "15.000", serviceOfferingId: null });

    const second = await app.inject({ method: "PUT", url: "/commissions/rules", headers, payload: { businessMemberId: account.owner.id, basis: "PERCENT_OF_SERVICE_PRICE", ratePercent: 25 } });
    expect(second.json().id).toBe(first.json().id);
    expect(second.json().ratePercent).toBe("25.000");

    const list = await app.inject({ method: "GET", url: "/commissions/rules", headers });
    expect(list.json()).toHaveLength(1);
  });

  it("rejects a fixed rule with no currency", async () => {
    const account = await fixture("commissions-bad@example.com");
    const res = await app.inject({ method: "PUT", url: "/commissions/rules", headers: authHeader(account.token), payload: { businessMemberId: account.owner.id, basis: "FIXED_PER_APPOINTMENT", fixedAmount: 10 } });
    expect(res.statusCode).toBe(400);
  });

  it("reports commission earned on completed appointments", async () => {
    const account = await fixture("commissions-report@example.com");
    const headers = authHeader(account.token);
    await app.inject({ method: "PUT", url: "/commissions/rules", headers, payload: { businessMemberId: account.owner.id, basis: "PERCENT_OF_SERVICE_PRICE", ratePercent: 20 } });

    const created = await app.inject({ method: "POST", url: "/appointments", headers, payload: { customerId: account.customer.id, assignedMemberId: account.owner.id, serviceName: "Cut", startsAt: "2026-09-10T09:00:00.000Z", endsAt: "2026-09-10T10:00:00.000Z", price: 100 } });
    const id = created.json().id;
    await app.inject({ method: "POST", url: `/appointments/${id}/status`, headers, payload: { status: "CONFIRMED" } });
    await app.inject({ method: "POST", url: `/appointments/${id}/status`, headers, payload: { status: "COMPLETED" } });

    const report = await app.inject({ method: "GET", url: "/commissions/report?from=2026-09-01&to=2026-09-30", headers });
    expect(report.statusCode).toBe(200);
    const mine = report.json().members.find((m: { businessMemberId: string }) => m.businessMemberId === account.owner.id);
    expect(mine.currencies[0]).toMatchObject({ appointmentCount: 1, commission: "20.00" });
    expect(report.json().disclaimer).toContain("Not payroll");
  });

  it("gates the feature behind the Business plan", async () => {
    const account = await registerAccount(app, { email: "commissions-free@example.com" }); // FREE plan
    const owner = await prisma.businessMember.findFirstOrThrow({ where: { businessId: account.businessId } });

    expect((await app.inject({ method: "GET", url: "/commissions/rules", headers: authHeader(account.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/commissions/rules", headers: authHeader(account.token), payload: { businessMemberId: owner.id, basis: "PERCENT_OF_SERVICE_PRICE", ratePercent: 10 } })).statusCode).toBe(403);

    await setPlan(account.businessId, "BUSINESS");
    expect((await app.inject({ method: "GET", url: "/commissions/rules", headers: authHeader(account.token) })).statusCode).toBe(200);
  });

  it("rejects a rule for a member outside the business", async () => {
    const account = await fixture("commissions-tenant@example.com");
    const outsider = await registerAccount(app, { email: "commissions-outsider@example.com" });
    const foreignMember = await prisma.businessMember.findFirstOrThrow({ where: { businessId: outsider.businessId } });
    const res = await app.inject({ method: "PUT", url: "/commissions/rules", headers: authHeader(account.token), payload: { businessMemberId: foreignMember.id, basis: "PERCENT_OF_SERVICE_PRICE", ratePercent: 10 } });
    expect(res.statusCode).toBe(400);
  });
});
