import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL } from "../src/lib/leadSources.js";

describe("GET /dashboard/coaching", () => {
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

  it("returns no insights once a business has no activity gaps and a complete profile", async () => {
    const { token } = await registerAccount(app);
    // A brand-new business is genuinely "at risk" on Business Health until
    // its profile is filled in — see businessHealth.ts's profileCompleteness
    // component, which (unlike every activity-based factor) is always
    // included, never gated on "not enough data yet." So a real zero-insight
    // case requires a complete profile, not just zero leads/reviews/reminders.
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

    const response = await app.inject({ method: "GET", url: "/dashboard/coaching", headers: authHeader(token) });

    expect(response.statusCode).toBe(200);
    expect(response.json().insights).toEqual([]);
    expect(response.json().generatedAt).toBeTruthy();
  });

  it("generates a business_health insight pointing at profile completion for a brand-new, unconfigured business", async () => {
    const { token } = await registerAccount(app);

    const response = await app.inject({ method: "GET", url: "/dashboard/coaching", headers: authHeader(token) });
    const insight = response.json().insights.find((i: { key: string }) => i.key === "business_health");

    expect(insight).toBeDefined();
    expect(insight.priority).toBe("critical");
    expect(insight.actionLink).toEqual({ kind: "businessSettings" });
  });

  it("generates an outstanding_revenue insight backed by real recorded numbers", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Owes Money" } });
    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 400 },
    });
    await app.inject({ method: "POST", url: `/leads/${lead.json().id}/mark-won`, headers: authHeader(token) });

    const response = await app.inject({ method: "GET", url: "/dashboard/coaching", headers: authHeader(token) });
    const insight = response.json().insights.find((i: { key: string }) => i.key === "outstanding_revenue");

    expect(insight).toBeDefined();
    expect(insight.evidence).toContain("$400.00 outstanding");
    expect(insight.actionLink).toEqual({ kind: "audience", audienceKey: "outstanding_payments" });
  });

  it("generates a customers_waiting insight that matches the same count Customer Intelligence already reports", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Waiting Customer" } });
    await prisma.lead.create({ data: { businessId, customerId: customer.id, status: "new", source: LEAD_SOURCE_MISSED_CALL } });

    const [coachingResponse, summaryResponse] = await Promise.all([
      app.inject({ method: "GET", url: "/dashboard/coaching", headers: authHeader(token) }),
      app.inject({ method: "GET", url: "/dashboard/summary", headers: authHeader(token) }),
    ]);

    const insight = coachingResponse.json().insights.find((i: { key: string }) => i.key === "customers_waiting");
    expect(insight).toBeDefined();
    expect(insight.evidence[0]).toContain(String(summaryResponse.json().customerIntelligence.needingFollowUpTotalCount));
  });

  it("every insight's action link points to a real, existing category or destination", async () => {
    const { token, businessId } = await registerAccount(app);
    const customer = await prisma.customer.create({ data: { businessId, name: "Test Customer" } });
    const lead = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(token),
      payload: { customerId: customer.id, source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 500 },
    });
    await app.inject({ method: "POST", url: `/leads/${lead.json().id}/mark-won`, headers: authHeader(token) });

    const response = await app.inject({ method: "GET", url: "/dashboard/coaching", headers: authHeader(token) });
    const validCategories = ["missed_call_followup", "customer_due", "review_opportunity", "payment_outstanding"];
    const validKinds = ["attentionCenter", "customerProfile", "comeback", "businessSettings", "audience", "insights"];

    for (const insight of response.json().insights) {
      expect(validKinds).toContain(insight.actionLink.kind);
      if (insight.actionLink.kind === "attentionCenter") {
        expect(validCategories).toContain(insight.actionLink.category);
      }
    }
  });

  it("is tenant-isolated", async () => {
    const businessA = await registerAccount(app, { email: "coaching-a@example.com" });
    const businessB = await registerAccount(app, { email: "coaching-b@example.com" });
    const customerB = await prisma.customer.create({ data: { businessId: businessB.businessId, name: "Business B Customer" } });
    const leadB = await app.inject({
      method: "POST",
      url: "/leads",
      headers: authHeader(businessB.token),
      payload: { customerId: customerB.id, source: LEAD_SOURCE_MISSED_CALL, estimatedValue: 9999 },
    });
    await app.inject({ method: "POST", url: `/leads/${leadB.json().id}/mark-won`, headers: authHeader(businessB.token) });

    const response = await app.inject({ method: "GET", url: "/dashboard/coaching", headers: authHeader(businessA.token) });

    expect(JSON.stringify(response.json())).not.toContain("9999");
    expect(JSON.stringify(response.json())).not.toContain("Business B Customer");
  });

  it("requires authentication", async () => {
    const response = await app.inject({ method: "GET", url: "/dashboard/coaching" });
    expect(response.statusCode).toBe(401);
  });
});
