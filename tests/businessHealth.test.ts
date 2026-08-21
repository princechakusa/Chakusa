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
});
