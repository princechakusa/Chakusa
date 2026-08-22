import { describe, expect, it } from "vitest";
import { classifyCustomerLifecycleStage, tallyLifecycleStages, DEFAULT_LIFECYCLE_THRESHOLDS } from "../src/lib/customerLifecycle.js";

const base = { lostLeadCount: 0, contactedOrBookedLeadCount: 0, newLeadCount: 0, wonLeadCount: 0, lifetimeValue: 0, daysSinceLastActivity: null };

describe("classifyCustomerLifecycleStage", () => {
  it("classifies a customer whose only lead is new as new_lead", () => {
    expect(classifyCustomerLifecycleStage({ ...base, newLeadCount: 1 })).toBe("new_lead");
  });

  it("classifies a customer who has been contacted but never won as contacted", () => {
    expect(classifyCustomerLifecycleStage({ ...base, contactedOrBookedLeadCount: 1 })).toBe("contacted");
  });

  it("classifies a customer whose every lead is lost as lost", () => {
    expect(classifyCustomerLifecycleStage({ ...base, lostLeadCount: 2 })).toBe("lost");
  });

  it("classifies a customer with exactly one won lead as first_customer", () => {
    expect(classifyCustomerLifecycleStage({ ...base, wonLeadCount: 1, daysSinceLastActivity: 1 })).toBe("first_customer");
  });

  it("classifies a customer with 2 won leads as returning", () => {
    expect(classifyCustomerLifecycleStage({ ...base, wonLeadCount: 2, daysSinceLastActivity: 1 })).toBe("returning");
  });

  it("classifies a customer at the loyal threshold as loyal, not returning", () => {
    expect(classifyCustomerLifecycleStage({ ...base, wonLeadCount: 3, daysSinceLastActivity: 1 })).toBe("loyal");
  });

  it("classifies a customer above the VIP lifetime value threshold as vip, even with only 1 won lead", () => {
    expect(classifyCustomerLifecycleStage({ ...base, wonLeadCount: 1, lifetimeValue: 1500, daysSinceLastActivity: 1 })).toBe("vip");
  });

  it("classifies a won customer who has gone quiet past the dormancy threshold as dormant", () => {
    expect(classifyCustomerLifecycleStage({ ...base, wonLeadCount: 1, daysSinceLastActivity: 50 })).toBe("dormant");
  });

  it("classifies dormancy ahead of VIP/loyal status — a quiet high-value customer is still dormant", () => {
    expect(classifyCustomerLifecycleStage({ ...base, wonLeadCount: 5, lifetimeValue: 5000, daysSinceLastActivity: 100 })).toBe("dormant");
  });

  it("does not classify as dormant when daysSinceLastActivity is null (never had any lead recorded post-win)", () => {
    expect(classifyCustomerLifecycleStage({ ...base, wonLeadCount: 1, daysSinceLastActivity: null })).toBe("first_customer");
  });

  it("respects custom thresholds", () => {
    const thresholds = { dormantAfterDays: 10, loyalWonLeadThreshold: 2, vipLifetimeValueThreshold: 100 };
    expect(classifyCustomerLifecycleStage({ ...base, wonLeadCount: 1, lifetimeValue: 150, daysSinceLastActivity: 1 }, thresholds)).toBe("vip");
    expect(classifyCustomerLifecycleStage({ ...base, wonLeadCount: 2, daysSinceLastActivity: 1 }, thresholds)).toBe("loyal");
  });

  it("exports sensible default thresholds", () => {
    expect(DEFAULT_LIFECYCLE_THRESHOLDS.dormantAfterDays).toBe(42);
    expect(DEFAULT_LIFECYCLE_THRESHOLDS.loyalWonLeadThreshold).toBeGreaterThan(1);
  });
});

describe("tallyLifecycleStages", () => {
  it("counts every stage, including zero for stages that never occurred", () => {
    const counts = tallyLifecycleStages(["new_lead", "new_lead", "dormant"]);
    expect(counts).toEqual({ lost: 0, new_lead: 2, contacted: 0, dormant: 1, vip: 0, loyal: 0, returning: 0, first_customer: 0 });
  });

  it("returns all zeros for an empty list", () => {
    expect(tallyLifecycleStages([])).toEqual({ lost: 0, new_lead: 0, contacted: 0, dormant: 0, vip: 0, loyal: 0, returning: 0, first_customer: 0 });
  });
});
