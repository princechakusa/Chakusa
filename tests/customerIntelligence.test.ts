import { describe, expect, it } from "vitest";
import { computeCustomerIntelligence } from "../src/lib/customerIntelligence.js";

describe("computeCustomerIntelligence", () => {
  it("returns null rates for a business with no won leads yet", () => {
    const result = computeCustomerIntelligence({
      totalCustomers: 5,
      newCustomersThisPeriod: 2,
      wonLeadCountsByCustomer: [],
      recoveryDaysTotal: 0,
      recoveryDaysSampleSize: 0,
      needingFollowUp: [],
      needingFollowUpTotalCount: 0,
    });

    expect(result.repeatCustomerRate).toBeNull();
    expect(result.averageLifetimeValue).toBeNull();
    expect(result.averageRecoveryDays).toBeNull();
    expect(result.customersWithWonLead).toBe(0);
    expect(result.returningCustomers).toBe(0);
    expect(result.topCustomersByValue).toEqual([]);
  });

  it("computes repeat customer rate as returning / customers with at least one won lead", () => {
    const result = computeCustomerIntelligence({
      totalCustomers: 10,
      newCustomersThisPeriod: 0,
      wonLeadCountsByCustomer: [
        { customerId: "a", wonLeadCount: 1, lifetimeValue: 100 },
        { customerId: "b", wonLeadCount: 2, lifetimeValue: 200 },
        { customerId: "c", wonLeadCount: 3, lifetimeValue: 300 },
      ],
      recoveryDaysTotal: 0,
      recoveryDaysSampleSize: 0,
      needingFollowUp: [],
      needingFollowUpTotalCount: 0,
    });

    // b and c have won more than once — 2 of 3 customers with a won lead.
    expect(result.customersWithWonLead).toBe(3);
    expect(result.returningCustomers).toBe(2);
    expect(result.repeatCustomerRate).toBeCloseTo(2 / 3);
  });

  it("computes average lifetime value across customers with a won lead", () => {
    const result = computeCustomerIntelligence({
      totalCustomers: 2,
      newCustomersThisPeriod: 0,
      wonLeadCountsByCustomer: [
        { customerId: "a", wonLeadCount: 1, lifetimeValue: 100 },
        { customerId: "b", wonLeadCount: 1, lifetimeValue: 300 },
      ],
      recoveryDaysTotal: 0,
      recoveryDaysSampleSize: 0,
      needingFollowUp: [],
      needingFollowUpTotalCount: 0,
    });

    expect(result.averageLifetimeValue).toBe(200);
  });

  it("computes average recovery days from the total/sampleSize pair", () => {
    const result = computeCustomerIntelligence({
      totalCustomers: 0,
      newCustomersThisPeriod: 0,
      wonLeadCountsByCustomer: [],
      recoveryDaysTotal: 15,
      recoveryDaysSampleSize: 3,
      needingFollowUp: [],
      needingFollowUpTotalCount: 0,
    });

    expect(result.averageRecoveryDays).toBe(5);
  });

  it("ranks topCustomersByValue by lifetime value, descending, capped at 5", () => {
    const wonLeadCountsByCustomer = Array.from({ length: 8 }, (_, i) => ({
      customerId: `c${i}`,
      wonLeadCount: 1,
      lifetimeValue: i * 10,
    }));

    const result = computeCustomerIntelligence({
      totalCustomers: 8,
      newCustomersThisPeriod: 0,
      wonLeadCountsByCustomer,
      recoveryDaysTotal: 0,
      recoveryDaysSampleSize: 0,
      needingFollowUp: [],
      needingFollowUpTotalCount: 0,
    });

    expect(result.topCustomersByValue).toHaveLength(5);
    expect(result.topCustomersByValue[0]).toEqual({ customerId: "c7", lifetimeValue: 70 });
    expect(result.topCustomersByValue[4]).toEqual({ customerId: "c3", lifetimeValue: 30 });
  });

  it("passes through needingFollowUp and its total count unchanged", () => {
    const needingFollowUp = [{ customerId: "a", customerName: "Jane", reason: "new_lead" as const }];
    const result = computeCustomerIntelligence({
      totalCustomers: 1,
      newCustomersThisPeriod: 0,
      wonLeadCountsByCustomer: [],
      recoveryDaysTotal: 0,
      recoveryDaysSampleSize: 0,
      needingFollowUp,
      needingFollowUpTotalCount: 4,
    });

    expect(result.needingFollowUp).toBe(needingFollowUp);
    expect(result.needingFollowUpTotalCount).toBe(4);
  });
});
