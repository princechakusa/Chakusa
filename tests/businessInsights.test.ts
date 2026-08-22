import { describe, expect, it } from "vitest";
import {
  buildMonthlyTrend,
  computeFastestReturningCustomers,
  computeLongestInactiveCustomers,
  computeServicePerformance,
  lastNMonthKeys,
} from "../src/lib/businessInsights.js";

describe("lastNMonthKeys", () => {
  it("returns the requested number of months, oldest first, ending with the current month", () => {
    const now = new Date(Date.UTC(2026, 2, 15)); // March 2026
    expect(lastNMonthKeys(3, now)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("correctly wraps across a year boundary", () => {
    const now = new Date(Date.UTC(2026, 0, 5)); // January 2026
    expect(lastNMonthKeys(3, now)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

describe("buildMonthlyTrend", () => {
  const months = ["2026-01", "2026-02", "2026-03"];
  const emptySeries = {
    newLeads: [], wonLeads: [], newCustomers: [], returningCustomers: [],
    recoveredRevenue: [], reviewRequestsSent: [], reviewsReceived: [], remindersCompleted: [],
  };

  it("zero-fills every month with no data at all", () => {
    const result = buildMonthlyTrend(months, emptySeries);
    expect(result).toHaveLength(3);
    expect(result.every((point) => point.newLeads === 0 && point.conversionRate === null)).toBe(true);
  });

  it("merges sparse per-metric series onto the shared month skeleton", () => {
    const result = buildMonthlyTrend(months, {
      ...emptySeries,
      newLeads: [{ month: "2026-02", value: 10 }],
      wonLeads: [{ month: "2026-02", value: 4 }],
      recoveredRevenue: [{ month: "2026-01", value: 500 }],
    });

    expect(result[0]).toMatchObject({ month: "2026-01", newLeads: 0, recoveredRevenue: 500 });
    expect(result[1]).toMatchObject({ month: "2026-02", newLeads: 10, wonLeads: 4, conversionRate: 0.4 });
    expect(result[2]).toMatchObject({ month: "2026-03", newLeads: 0, recoveredRevenue: 0 });
  });

  it("reports conversionRate as null, not 0, for a month with zero new leads", () => {
    const result = buildMonthlyTrend(months, emptySeries);
    expect(result[0]!.conversionRate).toBeNull();
  });
});

describe("computeServicePerformance", () => {
  const rows = [
    { service: "Haircut", leadCount: 10, wonCount: 8, revenue: 800 },
    { service: "Leak repair", leadCount: 5, wonCount: 1, revenue: 100 },
    { service: "One-off job", leadCount: 1, wonCount: 1, revenue: 500 },
  ];

  it("ranks mostRequested by lead count regardless of sample size", () => {
    const result = computeServicePerformance(rows);
    expect(result.mostRequested[0]!.service).toBe("Haircut");
  });

  it("ranks highestRevenue by revenue regardless of sample size", () => {
    const result = computeServicePerformance(rows);
    expect(result.highestRevenue[0]!.service).toBe("Haircut");
  });

  it("excludes a service with fewer than 3 leads from the conversion rankings", () => {
    const result = computeServicePerformance(rows);
    const convertingServices = [...result.highestConverting, ...result.lowestConverting].map((r) => r.service);
    expect(convertingServices).not.toContain("One-off job");
  });

  it("ranks highestConverting descending and lowestConverting ascending by conversion rate", () => {
    const result = computeServicePerformance(rows);
    expect(result.highestConverting[0]!.service).toBe("Haircut");
    expect(result.lowestConverting[0]!.service).toBe("Leak repair");
  });

  it("computes conversionRate as wonCount / leadCount", () => {
    const result = computeServicePerformance(rows);
    const haircut = result.mostRequested.find((r) => r.service === "Haircut");
    expect(haircut!.conversionRate).toBe(0.8);
  });
});

describe("computeFastestReturningCustomers", () => {
  const day = 86_400_000;

  it("excludes customers with fewer than 2 won leads", () => {
    const result = computeFastestReturningCustomers([{ customerId: "a", customerName: "Solo", wonAtTimestamps: [1000] }]);
    expect(result).toEqual([]);
  });

  it("computes the average gap in days between consecutive wins", () => {
    const result = computeFastestReturningCustomers([
      { customerId: "a", customerName: "Jane", wonAtTimestamps: [0, 10 * day, 20 * day] },
    ]);
    expect(result[0]!.averageDaysBetweenWins).toBeCloseTo(10);
  });

  it("sorts fastest (smallest average gap) first", () => {
    const result = computeFastestReturningCustomers([
      { customerId: "slow", customerName: "Slow", wonAtTimestamps: [0, 30 * day] },
      { customerId: "fast", customerName: "Fast", wonAtTimestamps: [0, 5 * day] },
    ]);
    expect(result[0]!.customerId).toBe("fast");
  });
});

describe("computeLongestInactiveCustomers", () => {
  const day = 86_400_000;
  const now = 1000 * day;

  it("computes days since last activity relative to `now`", () => {
    const result = computeLongestInactiveCustomers([{ customerId: "a", customerName: "Jane", lastActivityAt: 990 * day }], now);
    expect(result[0]!.daysSinceLastActivity).toBe(10);
  });

  it("sorts longest-inactive first", () => {
    const result = computeLongestInactiveCustomers(
      [
        { customerId: "recent", customerName: "Recent", lastActivityAt: 995 * day },
        { customerId: "stale", customerName: "Stale", lastActivityAt: 900 * day },
      ],
      now,
    );
    expect(result[0]!.customerId).toBe("stale");
  });
});
