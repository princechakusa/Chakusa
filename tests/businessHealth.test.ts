import { describe, expect, it } from "vitest";
import { computeBusinessHealth } from "../src/lib/businessHealth.js";

describe("computeBusinessHealth", () => {
  it("returns null score/label for a brand-new business with no activity at all", () => {
    const result = computeBusinessHealth({
      totalLeads: 0,
      contactRate: 0,
      conversionRate: 0,
      reviewRequestsSent: 0,
      reviewsReceived: 0,
      comebackCompletedCount: 0,
      customersDue: 0,
    });

    expect(result.score).toBeNull();
    expect(result.label).toBeNull();
  });

  it("averages only the components that have real denominators", () => {
    const result = computeBusinessHealth({
      totalLeads: 10,
      contactRate: 1,
      conversionRate: 1,
      reviewRequestsSent: 0,
      reviewsReceived: 0,
      comebackCompletedCount: 0,
      customersDue: 0,
    });

    // Only contactRate (100) and conversionRate (100) have data — reviews
    // and comebacks are both skipped, not averaged in as zeroes.
    expect(result.score).toBe(100);
    expect(result.label).toBe("excellent");
  });

  it("labels a mid-range score as needs_attention", () => {
    const result = computeBusinessHealth({
      totalLeads: 10,
      contactRate: 0.5,
      conversionRate: 0.3,
      reviewRequestsSent: 10,
      reviewsReceived: 4,
      comebackCompletedCount: 2,
      customersDue: 2,
    });

    // (50 + 30 + 40 + 50) / 4 = 42.5 -> 43
    expect(result.score).toBe(43);
    expect(result.label).toBe("needs_attention");
  });

  it("labels a low score as at_risk", () => {
    const result = computeBusinessHealth({
      totalLeads: 10,
      contactRate: 0.1,
      conversionRate: 0.05,
      reviewRequestsSent: 10,
      reviewsReceived: 0,
      comebackCompletedCount: 0,
      customersDue: 5,
    });

    expect(result.label).toBe("at_risk");
  });

  it("never exceeds 100 even if reviewsReceived somehow exceeds requestsSent", () => {
    const result = computeBusinessHealth({
      totalLeads: 0,
      contactRate: 0,
      conversionRate: 0,
      reviewRequestsSent: 2,
      reviewsReceived: 5,
      comebackCompletedCount: 0,
      customersDue: 0,
    });

    expect(result.score).toBe(100);
  });

  it("reports every factor, included or not, for explainability", () => {
    const result = computeBusinessHealth({
      totalLeads: 10,
      contactRate: 1,
      conversionRate: 1,
      reviewRequestsSent: 0,
      reviewsReceived: 0,
      comebackCompletedCount: 0,
      customersDue: 0,
    });

    expect(result.factors).toHaveLength(6);
    const byKey = Object.fromEntries(result.factors.map((f) => [f.key, f]));
    expect(byKey.contactRate).toMatchObject({ included: true, value: 100 });
    expect(byKey.conversionRate).toMatchObject({ included: true, value: 100 });
    expect(byKey.reviewConversion).toMatchObject({ included: false, value: null });
    expect(byKey.comebackCompletion).toMatchObject({ included: false, value: null });
    expect(byKey.profileCompleteness).toMatchObject({ included: false, value: null });
    expect(byKey.paymentCollectionRate).toMatchObject({ included: false, value: null });
  });

  it("includes profileCompleteness as a component whenever it's provided, unconditionally", () => {
    const result = computeBusinessHealth({
      totalLeads: 0,
      contactRate: 0,
      conversionRate: 0,
      reviewRequestsSent: 0,
      reviewsReceived: 0,
      comebackCompletedCount: 0,
      customersDue: 0,
      profileCompleteness: 0.5,
    });

    // Unlike lead/review/comeback ratios, profile completeness is always
    // meaningful — even a brand-new business's profile is either complete
    // or not — so a business with zero activity but a half-finished
    // profile gets a real score, not null.
    expect(result.score).toBe(50);
    expect(result.label).toBe("needs_attention");
  });

  it("includes paymentCollectionRate only when it isn't null", () => {
    const withData = computeBusinessHealth({
      totalLeads: 0, contactRate: 0, conversionRate: 0, reviewRequestsSent: 0, reviewsReceived: 0, comebackCompletedCount: 0, customersDue: 0,
      paymentCollectionRate: 0.75,
    });
    expect(withData.score).toBe(75);

    const withoutData = computeBusinessHealth({
      totalLeads: 0, contactRate: 0, conversionRate: 0, reviewRequestsSent: 0, reviewsReceived: 0, comebackCompletedCount: 0, customersDue: 0,
      paymentCollectionRate: null,
    });
    expect(withoutData.score).toBeNull();
  });
});
