import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL } from "../src/lib/leadSources.js";

describe("dashboard summary", () => {
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

  async function createWonLead(token: string, customerId: string, estimatedValue: number) {
    const created = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId, source: LEAD_SOURCE_MISSED_CALL, estimatedValue },
    });
    await app.inject({ method: "POST", url: `/leads/${created.json().id}/mark-won`, headers: authHeader(token) });
    return created.json().id;
  }

  it("aggregates lead funnel counts and conversion rate", async () => {
    const { token } = await registerAccount(app);

    const won = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 100 },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${won.json().id}/mark-won`,
      headers: authHeader(token),
    });

    const lost = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${lost.json().id}/mark-lost`,
      headers: authHeader(token),
    });

    await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL },
    });

    const summary = await app.inject({
      method: "GET",
      url: "/dashboard/summary",
      headers: authHeader(token),
    });

    const body = summary.json();
    expect(body.leads.total).toBe(3);
    expect(body.leads.won).toBe(1);
    expect(body.leads.lost).toBe(1);
    expect(body.leads.new).toBe(1);
    expect(body.leads.conversionRate).toBeCloseTo(1 / 3);
  });

  it("sums estimatedValue of won leads into recoveredRevenue.total", async () => {
    const { token } = await registerAccount(app);

    const leadA = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 120.5 },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${leadA.json().id}/mark-won`,
      headers: authHeader(token),
    });

    const leadB = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: "referral", estimatedValue: 80 },
    });
    await app.inject({
      method: "POST",
      url: `/leads/${leadB.json().id}/mark-won`,
      headers: authHeader(token),
    });

    const summary = await app.inject({
      method: "GET",
      url: "/dashboard/summary",
      headers: authHeader(token),
    });

    expect(summary.json().recoveredRevenue.total).toBeCloseTo(200.5);
    expect(summary.json().recoveredRevenue.missedCall).toBeCloseTo(120.5);
  });

  it("nets partial payments out of recoveredRevenue.outstanding, and excludes fully-paid leads", async () => {
    const { token } = await registerAccount(app);

    // Won, never marked paid — fully outstanding.
    const leadA = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 100 },
    });
    await app.inject({ method: "POST", url: `/leads/${leadA.json().id}/mark-won`, headers: authHeader(token) });

    // Won, partially paid — only the remainder is outstanding.
    const leadB = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 50 },
    });
    await app.inject({ method: "POST", url: `/leads/${leadB.json().id}/mark-won`, headers: authHeader(token) });
    await app.inject({
      method: "PATCH",
      url: `/leads/${leadB.json().id}/payment`,
      headers: authHeader(token),
      payload: { paymentStatus: "partially_paid", paidAmount: 20 },
    });

    // Won and fully paid — contributes nothing to outstanding.
    const leadC = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 30 },
    });
    await app.inject({ method: "POST", url: `/leads/${leadC.json().id}/mark-won`, headers: authHeader(token) });
    await app.inject({
      method: "PATCH",
      url: `/leads/${leadC.json().id}/payment`,
      headers: authHeader(token),
      payload: { paymentStatus: "paid", paidAmount: 30 },
    });

    const summary = await app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) });

    expect(summary.json().recoveredRevenue.outstanding).toBeCloseTo(100 + (50 - 20));
  });

  it("counts due reminders as customersDue and surfaces them as attention items", async () => {
    const { token } = await registerAccount(app);

    const pastDue = new Date();
    pastDue.setDate(pastDue.getDate() - 1);

    await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { dueDate: pastDue.toISOString() },
    });

    const futureDue = new Date();
    futureDue.setDate(futureDue.getDate() + 30);
    await app.inject({
      method: "POST",
      url: "/reminders",
      headers: authHeader(token),
      payload: { dueDate: futureDue.toISOString() },
    });

    const summary = await app.inject({
      method: "GET",
      url: "/dashboard/summary",
      headers: authHeader(token),
    });

    expect(summary.json().customersDue).toBe(1);
    expect(summary.json().todayAttentionItems).toHaveLength(1);
  });

  it("does not count a lead toward recoveredRevenue unless it went through mark-won", async () => {
    const { token } = await registerAccount(app);

    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 999 },
    });

    // PATCH can no longer set status directly (see leads.test.ts), so this
    // lead stays "new" and must not contribute to recovered revenue.
    await app.inject({
      method: "PATCH",
      url: `/leads/${lead.json().id}`,
      headers: authHeader(token),
      payload: { notes: "still new" },
    });

    const summary = await app.inject({
      method: "GET",
      url: "/dashboard/summary",
      headers: authHeader(token),
    });

    expect(summary.json().recoveredRevenue.total).toBe(0);
    expect(summary.json().leads.won).toBe(0);
  });

  describe("customer intelligence", () => {
    it("reports total and new-this-month customer counts", async () => {
      const { token } = await registerAccount(app);
      await app.inject({ method: "POST", url: "/customers", headers: authHeader(token), payload: { name: "Jane" } });
      await app.inject({ method: "POST", url: "/customers", headers: authHeader(token), payload: { name: "John" } });

      const summary = await app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) });

      expect(summary.json().customerIntelligence.totalCustomers).toBe(2);
      expect(summary.json().customerIntelligence.newCustomersThisPeriod).toBe(2);
    });

    it("computes repeat customer rate and lifetime value from won leads only", async () => {
      const { token } = await registerAccount(app);
      const repeatCustomer = await app.inject({ method: "POST", url: "/customers", headers: authHeader(token), payload: { name: "Repeat Customer" } });
      const oneTimeCustomer = await app.inject({ method: "POST", url: "/customers", headers: authHeader(token), payload: { name: "One Time" } });

      await createWonLead(token, repeatCustomer.json().id, 100);
      await createWonLead(token, repeatCustomer.json().id, 150);
      await createWonLead(token, oneTimeCustomer.json().id, 200);

      const summary = await app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) });
      const intelligence = summary.json().customerIntelligence;

      expect(intelligence.customersWithWonLead).toBe(2);
      expect(intelligence.returningCustomers).toBe(1);
      expect(intelligence.repeatCustomerRate).toBeCloseTo(0.5);
      expect(intelligence.averageLifetimeValue).toBeCloseTo((250 + 200) / 2);
      expect(intelligence.topCustomersByValue[0]).toMatchObject({ customerId: repeatCustomer.json().id, lifetimeValue: 250 });
    });

    it("lists customers needing follow-up from new leads and due reminders, without double-counting", async () => {
      const { token } = await registerAccount(app);
      const customer = await app.inject({ method: "POST", url: "/customers", headers: authHeader(token), payload: { name: "Needs Attention" } });

      await app.inject({
        method: "POST",
        url: "/leads",
        headers: authHeader(token),
        payload: { customerId: customer.json().id, source: LEAD_SOURCE_MISSED_CALL },
      });

      const summary = await app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) });
      const intelligence = summary.json().customerIntelligence;

      expect(intelligence.needingFollowUpTotalCount).toBe(1);
      expect(intelligence.needingFollowUp).toEqual([{ customerId: customer.json().id, customerName: "Needs Attention", reason: "new_lead" }]);
    });

    it("returns null repeat/lifetime-value metrics for a business with no won leads yet", async () => {
      const { token } = await registerAccount(app);

      const summary = await app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) });
      const intelligence = summary.json().customerIntelligence;

      expect(intelligence.repeatCustomerRate).toBeNull();
      expect(intelligence.averageLifetimeValue).toBeNull();
      expect(intelligence.averageRecoveryDays).toBeNull();
    });
  });

  describe("recommendations", () => {
    it("recommends completing the profile when it is incomplete", async () => {
      const { token } = await registerAccount(app);

      const summary = await app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) });

      expect(summary.json().recommendations.some((r: { key: string }) => r.key === "complete_profile")).toBe(true);
    });

    it("stops recommending profile completion once every field is filled", async () => {
      const { token } = await registerAccount(app);
      await app.inject({
        method: "PATCH",
        url: "/business",
        headers: authHeader(token),
        payload: {
          industry: "plumbing",
          phone: "+263771234567",
          description: "We fix pipes.",
          defaultServices: ["Leak repair"],
          workingHours: { summary: "Mon-Sat, 9-6" },
          googleReviewLink: "https://g.page/r/example",
        },
      });

      const summary = await app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) });

      expect(summary.json().recommendations.some((r: { key: string }) => r.key === "complete_profile")).toBe(false);
    });

    it("recommends collecting outstanding revenue once a won lead is unpaid", async () => {
      const { token } = await registerAccount(app);
      await createWonLead(token, (await app.inject({ method: "POST", url: "/customers", headers: authHeader(token), payload: { name: "Unpaid" } })).json().id, 500);

      const summary = await app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) });

      expect(summary.json().recommendations.some((r: { key: string }) => r.key === "collect_outstanding_revenue")).toBe(true);
    });
  });

  describe("business health explainability", () => {
    it("includes profileCompleteness and paymentCollectionRate as named factors", async () => {
      const { token } = await registerAccount(app);

      const summary = await app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) });
      const factors = summary.json().businessHealth.factors;

      expect(factors.map((f: { key: string }) => f.key)).toEqual(
        expect.arrayContaining(["contactRate", "conversionRate", "reviewConversion", "comebackCompletion", "profileCompleteness", "paymentCollectionRate"]),
      );
      const profileFactor = factors.find((f: { key: string }) => f.key === "profileCompleteness");
      expect(profileFactor.included).toBe(true);
    });
  });
});
