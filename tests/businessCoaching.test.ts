import { describe, expect, it } from "vitest";
import { generateBusinessCoaching, type BusinessCoachingInput } from "../src/lib/businessCoaching.js";
import type { AudienceSummary, SmartAudienceKey } from "../src/modules/customers/audiences.service.js";

function addAudience(input: BusinessCoachingInput, key: SmartAudienceKey, values: Partial<AudienceSummary> = {}) {
  input.audiences.push({ key, label: key.replaceAll("_", " "), customerIds: ["customer-a"], totalCustomers: 1, averageValue: 0, repeatRate: null, revenue: 0, outstandingPayments: 0, ...values });
}

/**
 * Minimal, fully-typed fixtures matching dashboard.service.ts's and
 * insights.service.ts's real return shapes — constructed by hand here so
 * every coaching-engine test stays pure and DB-free, the same testability
 * principle businessHealth.ts/customerIntelligence.ts already establish.
 */
function baseInput(): BusinessCoachingInput {
  return {
    summary: {
      recoveredRevenue: { total: 0, missedCall: 0, comebackCompletedCount: 0, outstanding: 0 },
      leads: { missedCalls: 0, new: 0, contacted: 0, booked: 0, won: 0, lost: 0, total: 0, conversionRate: 0, contactRate: 0 },
      reviews: { requestsSent: 0, reviewsReceived: 0, feedbackReceived: 0 },
      customersDue: 0,
      responseTime: { averageSeconds: null, sampleSize: 0 },
      recentActivity: [],
      todayAttentionItems: [],
      businessHealth: { score: null, label: null, factors: [] },
      customerIntelligence: {
        totalCustomers: 0,
        newCustomersThisPeriod: 0,
        customersWithWonLead: 0,
        returningCustomers: 0,
        repeatCustomerRate: null,
        averageLifetimeValue: null,
        averageRecoveryDays: null,
        needingFollowUp: [],
        needingFollowUpTotalCount: 0,
        topCustomersByValue: [],
      },
      recommendations: [],
      generatedAt: new Date(),
      windowStart: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    insights: {
      monthlyTrend: [],
      servicePerformance: { mostRequested: [], highestRevenue: [], highestConverting: [], lowestConverting: [] },
      customerValue: { fastestReturningCustomers: [], longestInactiveCustomers: [], atRiskCustomers: [], repeatCustomers: [] },
      recoveryPerformance: {
        missedCallsRecovered: 0,
        missedCallsTotal: 0,
        recoverySuccessRate: 0,
        recoveryConversionRate: 0,
        reviewRequestSuccessRate: null,
        reminderCompletionRate: null,
        averageRecoveryDays: null,
      },
      customerLifecycle: {
        counts: { lost: 0, new_lead: 0, contacted: 0, dormant: 0, vip: 0, loyal: 0, returning: 0, first_customer: 0 },
        totalCustomers: 0,
      },
      generatedAt: new Date(),
      windowStart: new Date(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    audiences: [],
  };
}

describe("generateBusinessCoaching", () => {
  it("returns no insights for a business with no activity and a complete profile", () => {
    expect(generateBusinessCoaching(baseInput())).toEqual([]);
  });

  it("generates a critical customers_waiting insight once the follow-up backlog reaches 5", () => {
    const input = baseInput();
    input.summary.customerIntelligence.needingFollowUpTotalCount = 5;
    input.summary.customerIntelligence.needingFollowUp = [{ customerId: "a", customerName: "Jane", reason: "new_lead" }];

    const insights = generateBusinessCoaching(input);
    const insight = insights.find((i) => i.key === "customers_waiting");
    expect(insight?.priority).toBe("critical");
    expect(insight?.actionLink).toEqual({ kind: "attentionCenter", category: "missed_call_followup" });
    expect(insight?.evidence).toContain("5 customers currently need follow-up");
  });

  it("generates a high (not critical) customers_waiting insight below the backlog threshold", () => {
    const input = baseInput();
    input.summary.customerIntelligence.needingFollowUpTotalCount = 1;
    input.summary.customerIntelligence.needingFollowUp = [{ customerId: "a", customerName: "Jane", reason: "comeback_due" }];

    const insight = generateBusinessCoaching(input).find((i) => i.key === "customers_waiting");
    expect(insight?.priority).toBe("high");
    expect(insight?.actionLink).toEqual({ kind: "attentionCenter", category: "customer_due" });
  });

  it("generates a critical outstanding_revenue insight when over half of recovered revenue is unpaid", () => {
    const input = baseInput();
    input.summary.recoveredRevenue = { total: 1000, missedCall: 0, comebackCompletedCount: 0, outstanding: 600, appointmentCollected: 0, appointmentOutstanding: 0 };
    addAudience(input, "outstanding_payments", { totalCustomers: 2, outstandingPayments: 600 });

    const insight = generateBusinessCoaching(input).find((i) => i.key === "outstanding_revenue");
    expect(insight?.priority).toBe("critical");
    expect(insight?.evidence).toContain("$600.00 outstanding");
    expect(insight?.actionLink).toEqual({ kind: "audience", audienceKey: "outstanding_payments" });
  });

  it("generates a high (not critical) outstanding_revenue insight when under half is unpaid", () => {
    const input = baseInput();
    input.summary.recoveredRevenue = { total: 1000, missedCall: 0, comebackCompletedCount: 0, outstanding: 100, appointmentCollected: 0, appointmentOutstanding: 0 };
    addAudience(input, "outstanding_payments", { outstandingPayments: 100 });

    const insight = generateBusinessCoaching(input).find((i) => i.key === "outstanding_revenue");
    expect(insight?.priority).toBe("high");
  });

  it("does not generate outstanding_revenue when nothing is owed", () => {
    const insight = generateBusinessCoaching(baseInput()).find((i) => i.key === "outstanding_revenue");
    expect(insight).toBeUndefined();
  });

  it("points a business_health insight at the weakest factor's own action", () => {
    const input = baseInput();
    input.summary.businessHealth = {
      score: 35,
      label: "at_risk",
      factors: [
        { key: "contactRate", label: "How often you follow up on a lead", value: 80, included: true },
        { key: "reviewConversion", label: "How often a review request becomes a review", value: 10, included: true },
      ],
    };

    const insight = generateBusinessCoaching(input).find((i) => i.key === "business_health");
    expect(insight?.priority).toBe("critical");
    expect(insight?.actionLink).toEqual({ kind: "attentionCenter", category: "review_opportunity" });
    expect(insight?.evidence.some((e) => e.includes("review conversion") || e.toLowerCase().includes("review"))).toBe(true);
  });

  it("does not generate a business_health insight when health is good or excellent", () => {
    const input = baseInput();
    input.summary.businessHealth = { score: 90, label: "excellent", factors: [{ key: "contactRate", label: "x", value: 90, included: true }] };

    expect(generateBusinessCoaching(input).find((i) => i.key === "business_health")).toBeUndefined();
  });

  it("does not generate a business_health insight when the score is null (no data yet)", () => {
    const insight = generateBusinessCoaching(baseInput()).find((i) => i.key === "business_health");
    expect(insight).toBeUndefined();
  });

  it("generates a repeat_customer_rate insight only with enough sample size and a genuinely low rate", () => {
    const input = baseInput();
    input.summary.customerIntelligence.repeatCustomerRate = 0.1;
    input.summary.customerIntelligence.customersWithWonLead = 5;
    input.summary.customerIntelligence.averageLifetimeValue = 250;

    const insight = generateBusinessCoaching(input).find((i) => i.key === "repeat_customer_rate");
    expect(insight?.priority).toBe("medium");
    expect(insight?.actionLink).toEqual({ kind: "comeback" });
  });

  it("does not generate repeat_customer_rate insight below the minimum sample size, even if the rate is low", () => {
    const input = baseInput();
    input.summary.customerIntelligence.repeatCustomerRate = 0;
    input.summary.customerIntelligence.customersWithWonLead = 1;

    expect(generateBusinessCoaching(input).find((i) => i.key === "repeat_customer_rate")).toBeUndefined();
  });

  it("does not generate repeat_customer_rate insight once the rate is healthy", () => {
    const input = baseInput();
    input.summary.customerIntelligence.repeatCustomerRate = 0.6;
    input.summary.customerIntelligence.customersWithWonLead = 10;

    expect(generateBusinessCoaching(input).find((i) => i.key === "repeat_customer_rate")).toBeUndefined();
  });

  it("generates a medium dormant_customers insight below the high-count threshold", () => {
    const input = baseInput();
    input.insights.customerLifecycle = { counts: { ...input.insights.customerLifecycle.counts, dormant: 2 }, totalCustomers: 8 };
    addAudience(input, "dormant", { totalCustomers: 2 });

    const insight = generateBusinessCoaching(input).find((i) => i.key === "dormant_customers");
    expect(insight?.priority).toBe("medium");
    expect(insight?.actionLink).toEqual({ kind: "audience", audienceKey: "dormant" });
    expect(insight?.evidence).toContain("2 dormant customers");
  });

  it("generates a high dormant_customers insight at or above the high-count threshold", () => {
    const input = baseInput();
    input.insights.customerLifecycle = { counts: { ...input.insights.customerLifecycle.counts, dormant: 5 }, totalCustomers: 20 };
    addAudience(input, "dormant", { totalCustomers: 5 });

    const insight = generateBusinessCoaching(input).find((i) => i.key === "dormant_customers");
    expect(insight?.priority).toBe("high");
  });

  it("does not generate dormant_customers insight when no customer is dormant", () => {
    const input = baseInput();
    input.insights.customerLifecycle = { counts: { ...input.insights.customerLifecycle.counts, vip: 3 }, totalCustomers: 8 };

    expect(generateBusinessCoaching(input).find((i) => i.key === "dormant_customers")).toBeUndefined();
  });

  it("generates review coaching only when the existing Needs reviews audience has members", () => {
    const input = baseInput();
    addAudience(input, "needs_reviews", { label: "Needs reviews", totalCustomers: 3, revenue: 900 });

    const insight = generateBusinessCoaching(input).find((i) => i.key === "needs_reviews_audience");
    expect(insight?.evidence).toContain("3 customers in Needs reviews");
    expect(insight?.actionLink).toEqual({ kind: "audience", audienceKey: "needs_reviews" });
  });

  it.each([
    ["vip", "VIP customers"],
    ["high_value", "High-value customers"],
    ["loyal", "Loyal customers"],
  ] as const)("generates coaching for a non-empty %s audience using its existing metrics", (key, label) => {
    const input = baseInput();
    addAudience(input, key, { label, totalCustomers: 2, revenue: 2400, averageValue: 1200 });

    const insight = generateBusinessCoaching(input).find((i) => i.key === `${key}_audience`);
    expect(insight?.evidence).toEqual([`2 customers in ${label}`, "$2400.00 total value", "Average value: $1200.00"]);
    expect(insight?.actionLink).toEqual({ kind: "audience", audienceKey: key });
    expect(insight?.priority).toBe("low");
  });

  it("never references an empty audience", () => {
    const input = baseInput();
    addAudience(input, "vip", { label: "VIP customers", customerIds: [], totalCustomers: 0 });

    expect(generateBusinessCoaching(input).some((insight) => insight.actionLink.kind === "audience")).toBe(false);
  });

  it("generates a service_performance_gap insight only when the conversion gap is large enough", () => {
    const input = baseInput();
    input.insights.servicePerformance = {
      mostRequested: [],
      highestRevenue: [],
      highestConverting: [{ service: "Haircut", leadCount: 10, wonCount: 9, conversionRate: 0.9, revenue: 900 }],
      lowestConverting: [{ service: "Coloring", leadCount: 5, wonCount: 1, conversionRate: 0.2, revenue: 100 }],
    };

    const insight = generateBusinessCoaching(input).find((i) => i.key === "service_performance_gap");
    expect(insight?.priority).toBe("low");
    expect(insight?.actionLink).toEqual({ kind: "insights" });
  });

  it("does not generate service_performance_gap when the conversion gap is small", () => {
    const input = baseInput();
    input.insights.servicePerformance = {
      mostRequested: [],
      highestRevenue: [],
      highestConverting: [{ service: "Haircut", leadCount: 10, wonCount: 8, conversionRate: 0.8, revenue: 800 }],
      lowestConverting: [{ service: "Coloring", leadCount: 5, wonCount: 3, conversionRate: 0.6, revenue: 300 }],
    };

    expect(generateBusinessCoaching(input).find((i) => i.key === "service_performance_gap")).toBeUndefined();
  });

  it("sorts insights critical-first, deterministically", () => {
    const input = baseInput();
    input.summary.recoveredRevenue = { total: 100, missedCall: 0, comebackCompletedCount: 0, outstanding: 60, appointmentCollected: 0, appointmentOutstanding: 0 }; // critical
    addAudience(input, "outstanding_payments", { outstandingPayments: 60 });
    input.summary.customerIntelligence.needingFollowUpTotalCount = 1; // high
    input.summary.customerIntelligence.needingFollowUp = [{ customerId: "a", customerName: "Jane", reason: "new_lead" }];
    input.summary.customerIntelligence.repeatCustomerRate = 0.1; // medium
    input.summary.customerIntelligence.customersWithWonLead = 5;

    const insights = generateBusinessCoaching(input);
    const priorities = insights.map((i) => i.priority);
    expect(priorities).toEqual(["critical", "high", "medium"]);
  });

  it("produces byte-identical output for the same input twice — no randomness", () => {
    const input = baseInput();
    input.summary.recoveredRevenue = { total: 100, missedCall: 0, comebackCompletedCount: 0, outstanding: 60, appointmentCollected: 0, appointmentOutstanding: 0 };
    addAudience(input, "outstanding_payments", { outstandingPayments: 60 });

    expect(generateBusinessCoaching(input)).toEqual(generateBusinessCoaching(input));
  });

  it("never mentions the Recovery Engine — that state is on-device and never reported to the backend", () => {
    const input = baseInput();
    input.summary.recoveredRevenue = { total: 100, missedCall: 0, comebackCompletedCount: 0, outstanding: 60, appointmentCollected: 0, appointmentOutstanding: 0 };
    addAudience(input, "outstanding_payments", { outstandingPayments: 60 });
    input.summary.customerIntelligence.needingFollowUpTotalCount = 5;
    input.summary.businessHealth = { score: 20, label: "at_risk", factors: [{ key: "contactRate", label: "x", value: 20, included: true }] };

    const insights = generateBusinessCoaching(input);
    expect(insights.every((i) => !JSON.stringify(i).toLowerCase().includes("recovery engine"))).toBe(true);
  });
});
