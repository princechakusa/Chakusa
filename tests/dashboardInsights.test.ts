import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL } from "../src/lib/leadSources.js";

describe("GET /dashboard/insights", () => {
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

  async function createWonLead(businessId: string, customerId: string, estimatedValue: number, wonAt: Date, service: string) {
    return prisma.lead.create({
      data: { businessId, customerId, source: LEAD_SOURCE_MISSED_CALL, status: "won", estimatedValue, wonAt, serviceRequested: service, createdAt: wonAt },
    });
  }

  it("returns a 6-month trend covering the current month even with no data", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({ method: "GET", url: "/dashboard/insights", headers: authHeader(token) });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.monthlyTrend).toHaveLength(6);
    expect(body.monthlyTrend.every((point: { newLeads: number }) => point.newLeads === 0)).toBe(true);
    const currentMonth = new Date().toISOString().slice(0, 7);
    expect(body.monthlyTrend[5].month).toBe(currentMonth);
  });

  it("buckets recovered revenue by the month a lead was actually won", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Trend Customer" } });
    const now = new Date();
    await createWonLead(businessId, customer.id, 300, now, "Haircut");

    const response = await app.inject({ method: "GET", url: "/dashboard/insights", headers: authHeader(token) });
    const currentMonthPoint = response.json().monthlyTrend.at(-1);

    expect(currentMonthPoint.recoveredRevenue).toBe(300);
    expect(currentMonthPoint.newLeads).toBe(1);
    expect(currentMonthPoint.wonLeads).toBe(1);
    expect(currentMonthPoint.conversionRate).toBe(1);
  });

  it("attributes collected appointment revenue to payment and booking sources", async () => {
    const { token, businessId, userId } = await registerAccount(app, { email: "attribution@example.com" });
    const customer = await prisma.customer.create({ data: { businessId, name: "Revenue Customer" } });
    const publicAppointment = await prisma.appointment.create({ data: { businessId, customerId: customer.id, createdByUserId: userId, serviceName: "Public service", startsAt: new Date(), endsAt: new Date(Date.now() + 60_000), status: "COMPLETED", price: 100, paidAmount: 100, paymentStatus: "paid", paymentReminderSentAt: new Date(Date.now() - 60_000) } });
    await prisma.publicBookingAccess.create({ data: { businessId, appointmentId: publicAppointment.id, tokenHash: "attribution-token", expiresAt: new Date(Date.now() + 86_400_000) } });
    await prisma.appointmentPaymentTransaction.create({ data: { businessId, appointmentId: publicAppointment.id, kind: "full", status: "paid", amount: 100, currency: "USD", paidAt: new Date() } });
    await prisma.appointment.create({ data: { businessId, customerId: customer.id, createdByUserId: userId, serviceName: "Staff service", startsAt: new Date(), endsAt: new Date(Date.now() + 60_000), status: "COMPLETED", price: 40, paidAmount: 40, paymentStatus: "paid" } });

    const response = await app.inject({ method: "GET", url: "/dashboard/insights", headers: authHeader(token) });
    expect(response.statusCode).toBe(200);
    expect(response.json().revenueAttribution).toEqual({ totalCollected: 140, stripeCollected: 100, manuallyRecorded: 40, publicBookingCollected: 100, staffBookingCollected: 40, collectedAfterPaymentReminder: 100 });
  });

  it("ranks service performance by requests, revenue, and conversion rate", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Service Customer" } });
    const now = new Date();

    for (let i = 0; i < 4; i += 1) await createWonLead(businessId, customer.id, 100, now, "Haircut");
    await prisma.lead.create({ data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "lost", serviceRequested: "Haircut" } });
    for (let i = 0; i < 3; i += 1) {
      await prisma.lead.create({ data: { businessId, customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, status: "lost", serviceRequested: "Coloring" } });
    }

    const response = await app.inject({ method: "GET", url: "/dashboard/insights", headers: authHeader(token) });
    const performance = response.json().servicePerformance;

    expect(performance.mostRequested[0]).toMatchObject({ service: "Haircut", leadCount: 5 });
    expect(performance.highestRevenue[0]).toMatchObject({ service: "Haircut", revenue: 400 });
    expect(performance.highestConverting[0].service).toBe("Haircut");
    expect(performance.lowestConverting[0].service).toBe("Coloring");
  });

  it("excludes a service with fewer than 3 leads from the conversion rankings but still lists it in mostRequested", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "One Off" } });
    await createWonLead(businessId, customer.id, 500, new Date(), "Emergency plumbing");

    const response = await app.inject({ method: "GET", url: "/dashboard/insights", headers: authHeader(token) });
    const performance = response.json().servicePerformance;

    expect(performance.mostRequested.some((r: { service: string }) => r.service === "Emergency plumbing")).toBe(true);
    expect(performance.highestConverting.some((r: { service: string }) => r.service === "Emergency plumbing")).toBe(false);
  });

  it("identifies fastest-returning customers from real won-lead timestamps", async () => {
    const { token, businessId } = await registerAccount(app);
    const fast = await prisma.customer.create({ data: { businessId, name: "Fast Returner" } });
    const slow = await prisma.customer.create({ data: { businessId, name: "Slow Returner" } });
    const now = Date.now();

    await createWonLead(businessId, fast.id, 100, new Date(now - 40 * 86_400_000), "Service");
    await createWonLead(businessId, fast.id, 100, new Date(now - 35 * 86_400_000), "Service");
    await createWonLead(businessId, slow.id, 100, new Date(now - 200 * 86_400_000), "Service");
    await createWonLead(businessId, slow.id, 100, new Date(now - 10 * 86_400_000), "Service");

    const response = await app.inject({ method: "GET", url: "/dashboard/insights", headers: authHeader(token) });
    const fastest = response.json().customerValue.fastestReturningCustomers;

    expect(fastest[0].customerName).toBe("Fast Returner");
  });

  it("does not include a customer with only one won lead in fastest-returning", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Only Once" } });
    await createWonLead(businessId, customer.id, 100, new Date(), "Service");

    const response = await app.inject({ method: "GET", url: "/dashboard/insights", headers: authHeader(token) });

    expect(response.json().customerValue.fastestReturningCustomers).toEqual([]);
  });

  it("identifies the longest-inactive customer among those with at least one lead", async () => {
    const { token, businessId } = await registerAccount(app);
    const stale = await prisma.customer.create({ data: { businessId, name: "Long Gone" } });
    const recent = await prisma.customer.create({ data: { businessId, name: "Recently Seen" } });
    await prisma.lead.create({ data: { businessId, customerId: stale.id, source: LEAD_SOURCE_MISSED_CALL, createdAt: new Date(Date.now() - 300 * 86_400_000) } });
    await prisma.lead.create({ data: { businessId, customerId: recent.id, source: LEAD_SOURCE_MISSED_CALL, createdAt: new Date() } });

    const response = await app.inject({ method: "GET", url: "/dashboard/insights", headers: authHeader(token) });
    const longestInactive = response.json().customerValue.longestInactiveCustomers;

    expect(longestInactive[0].customerName).toBe("Long Gone");
  });

  it("reuses the exact Business Health / Customer Intelligence figures for recovery performance", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Recovery Customer" } });
    await createWonLead(businessId, customer.id, 100, new Date(), "Service");

    const [insightsResponse, summaryResponse] = await Promise.all([
      app.inject({ method: "GET", url: "/dashboard/insights", headers: authHeader(token) }),
      app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) }),
    ]);

    const insights = insightsResponse.json();
    const summary = summaryResponse.json();
    expect(insights.recoveryPerformance.recoverySuccessRate).toBe(summary.leads.contactRate);
    expect(insights.recoveryPerformance.recoveryConversionRate).toBe(summary.leads.conversionRate);
    expect(insights.recoveryPerformance.averageRecoveryDays).toBe(summary.customerIntelligence.averageRecoveryDays);
    expect(insights.recoveryPerformance.missedCallsRecovered).toBe(1);
  });

  it("is tenant-isolated across every section", async () => {
    const businessA = await registerAccount(app, { email: "insights-a@example.com" });
    const businessB = await registerAccount(app, { email: "insights-b@example.com" });
    const customerB = await prisma.customer.create({ data: { businessId: businessB.businessId, name: "Business B Customer" } });
    await createWonLead(businessB.businessId, customerB.id, 999, new Date(), "Secret Service");

    const response = await app.inject({ method: "GET", url: "/dashboard/insights", headers: authHeader(businessA.token) });
    const body = response.json();

    expect(body.servicePerformance.mostRequested).toEqual([]);
    expect(body.customerValue.longestInactiveCustomers).toEqual([]);
    expect(JSON.stringify(body)).not.toContain("Secret Service");
    expect(JSON.stringify(body)).not.toContain("Business B Customer");
  });

  // -------------------------------------------------------------------
  // customerLifecycle — Customer Lifecycle Automation Engine breakdown
  // -------------------------------------------------------------------

  it("exposes a customer lifecycle stage breakdown covering every customer with lead history", async () => {
    const { token, businessId } = await registerAccount(app);
    const dormantCustomer = await prisma.customer.create({ data: { businessId, name: "Dormant Customer" } });
    await createWonLead(businessId, dormantCustomer.id, 200, new Date(Date.now() - 60 * 86_400_000), "Detailing");
    const newLeadCustomer = await prisma.customer.create({ data: { businessId, name: "New Lead Customer" } });
    await prisma.lead.create({ data: { businessId, customerId: newLeadCustomer.id, source: LEAD_SOURCE_MISSED_CALL, status: "new" } });

    const response = await app.inject({ method: "GET", url: "/dashboard/insights", headers: authHeader(token) });
    const { customerLifecycle } = response.json();

    expect(customerLifecycle.totalCustomers).toBe(2);
    expect(customerLifecycle.counts.dormant).toBe(1);
    expect(customerLifecycle.counts.new_lead).toBe(1);
  });

  it("never includes another business's customers in the lifecycle breakdown", async () => {
    const businessA = await registerAccount(app, { email: "lifecycle-insights-a@example.com" });
    const businessB = await registerAccount(app, { email: "lifecycle-insights-b@example.com" });
    const customerB = await prisma.customer.create({ data: { businessId: businessB.businessId, name: "Business B Customer" } });
    await createWonLead(businessB.businessId, customerB.id, 500, new Date(), "Service");

    const response = await app.inject({ method: "GET", url: "/dashboard/insights", headers: authHeader(businessA.token) });

    expect(response.json().customerLifecycle.totalCustomers).toBe(0);
  });
});
