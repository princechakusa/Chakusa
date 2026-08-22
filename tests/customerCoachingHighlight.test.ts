import { describe, expect, it } from "vitest";
import { generateCustomerCoachingHighlight } from "../src/lib/customerCoachingHighlight.js";

const base = {
  customerName: "Jane",
  lifecycleStage: "contacted" as const,
  daysSinceLastActivity: null,
  hasOutstandingPayment: false,
  outstandingAmount: null,
  hasDueReminder: false,
  hasAnyReviewRequest: false,
  wonLeadCount: 0,
};

describe("generateCustomerCoachingHighlight", () => {
  it("returns null when nothing is actionable", () => {
    expect(generateCustomerCoachingHighlight(base)).toBeNull();
  });

  it("prioritizes an outstanding payment above everything else", () => {
    const highlight = generateCustomerCoachingHighlight({ ...base, hasOutstandingPayment: true, outstandingAmount: "$50.00", lifecycleStage: "dormant", daysSinceLastActivity: 90 });
    expect(highlight?.quickAction).toBe("recordPayment");
    expect(highlight?.evidence).toContain("$50.00 outstanding");
  });

  it("suggests a comeback reminder for a dormant customer with no reminder already due", () => {
    const highlight = generateCustomerCoachingHighlight({ ...base, lifecycleStage: "dormant", daysSinceLastActivity: 60 });
    expect(highlight?.quickAction).toBe("createReminder");
    expect(highlight?.evidence).toContain("60 days since last activity");
  });

  it("does not suggest a reminder for a dormant customer who already has one due", () => {
    expect(generateCustomerCoachingHighlight({ ...base, lifecycleStage: "dormant", hasDueReminder: true })).toBeNull();
  });

  it("suggests requesting a review for a won customer who has never been asked", () => {
    const highlight = generateCustomerCoachingHighlight({ ...base, wonLeadCount: 2 });
    expect(highlight?.quickAction).toBe("requestReview");
    expect(highlight?.evidence).toContain("2 completed jobs");
  });

  it("does not suggest a review for a customer who has already been asked before", () => {
    expect(generateCustomerCoachingHighlight({ ...base, wonLeadCount: 2, hasAnyReviewRequest: true })).toBeNull();
  });

  it("does not suggest a review for a customer with zero won leads", () => {
    expect(generateCustomerCoachingHighlight({ ...base, wonLeadCount: 0 })).toBeNull();
  });
});
