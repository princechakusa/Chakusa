/**
 * Pure shaping/derivation for the Business Insights & Growth Analytics
 * Engine — kept separate from the SQL querying in insights.service.ts so
 * every number here is deterministic and unit-testable without a
 * database, the same split businessHealth.ts and customerIntelligence.ts
 * already establish. Nothing in this file estimates, predicts, or
 * fabricates anything: every function takes real aggregate rows (however
 * sparse) and shapes them into a complete, explainable answer.
 */

// ---------------------------------------------------------------------------
// Monthly trend
// ---------------------------------------------------------------------------

/** "YYYY-MM" — the granularity every trend series is bucketed at. */
export type MonthKey = string;

export interface MonthlyMetricRow {
  month: MonthKey;
  value: number;
}

export interface MonthlyTrendPoint {
  month: MonthKey;
  newLeads: number;
  wonLeads: number;
  /** null for a month with zero new leads — not enough data for a rate, not a 0% rate. */
  conversionRate: number | null;
  newCustomers: number;
  returningCustomers: number;
  recoveredRevenue: number;
  reviewRequestsSent: number;
  reviewsReceived: number;
  remindersCompleted: number;
}

/** Last `count` calendar months as "YYYY-MM" keys, oldest first, ending with the current month. Pure — never touches a clock other than the one passed in. */
export function lastNMonthKeys(count: number, now: Date = new Date()): MonthKey[] {
  const months: MonthKey[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

interface MonthlyTrendSeries {
  newLeads: MonthlyMetricRow[];
  wonLeads: MonthlyMetricRow[];
  newCustomers: MonthlyMetricRow[];
  returningCustomers: MonthlyMetricRow[];
  recoveredRevenue: MonthlyMetricRow[];
  reviewRequestsSent: MonthlyMetricRow[];
  reviewsReceived: MonthlyMetricRow[];
  remindersCompleted: MonthlyMetricRow[];
}

function toLookup(rows: MonthlyMetricRow[]): Map<MonthKey, number> {
  return new Map(rows.map((row) => [row.month, row.value]));
}

/**
 * Merges up to 8 independently-queried monthly series (each potentially
 * sparse — a month with zero leads simply never produced a GROUP BY row)
 * into one complete array covering every month in `months`, defaulting any
 * missing month to 0. This is the only place "zero-fill" happens, kept
 * pure and unit-tested so a query that returns no rows for a quiet month
 * is never confused with a query that failed.
 */
export function buildMonthlyTrend(months: MonthKey[], series: MonthlyTrendSeries): MonthlyTrendPoint[] {
  const newLeads = toLookup(series.newLeads);
  const wonLeads = toLookup(series.wonLeads);
  const newCustomers = toLookup(series.newCustomers);
  const returningCustomers = toLookup(series.returningCustomers);
  const recoveredRevenue = toLookup(series.recoveredRevenue);
  const reviewRequestsSent = toLookup(series.reviewRequestsSent);
  const reviewsReceived = toLookup(series.reviewsReceived);
  const remindersCompleted = toLookup(series.remindersCompleted);

  return months.map((month) => {
    const monthNewLeads = newLeads.get(month) ?? 0;
    const monthWonLeads = wonLeads.get(month) ?? 0;
    return {
      month,
      newLeads: monthNewLeads,
      wonLeads: monthWonLeads,
      conversionRate: monthNewLeads > 0 ? monthWonLeads / monthNewLeads : null,
      newCustomers: newCustomers.get(month) ?? 0,
      returningCustomers: returningCustomers.get(month) ?? 0,
      recoveredRevenue: recoveredRevenue.get(month) ?? 0,
      reviewRequestsSent: reviewRequestsSent.get(month) ?? 0,
      reviewsReceived: reviewsReceived.get(month) ?? 0,
      remindersCompleted: remindersCompleted.get(month) ?? 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Service performance
// ---------------------------------------------------------------------------

export interface ServiceAggregateRow {
  service: string;
  leadCount: number;
  wonCount: number;
  revenue: number;
}

export interface ServicePerformanceRow extends ServiceAggregateRow {
  conversionRate: number;
}

export interface ServicePerformance {
  mostRequested: ServicePerformanceRow[];
  highestRevenue: ServicePerformanceRow[];
  /** Only services with at least MIN_SAMPLE_SIZE leads — a service with one lucky lead is not "100% converting." */
  highestConverting: ServicePerformanceRow[];
  lowestConverting: ServicePerformanceRow[];
}

/** Below this many leads, a service's conversion rate is noise, not signal — excluded from the converting rankings (not hidden from mostRequested/highestRevenue, which don't depend on rate). */
const MIN_SAMPLE_SIZE_FOR_CONVERSION_RANKING = 3;
const TOP_N = 5;

export function computeServicePerformance(rows: ServiceAggregateRow[]): ServicePerformance {
  const shaped: ServicePerformanceRow[] = rows.map((row) => ({
    ...row,
    conversionRate: row.leadCount > 0 ? row.wonCount / row.leadCount : 0,
  }));

  const mostRequested = [...shaped].sort((a, b) => b.leadCount - a.leadCount).slice(0, TOP_N);
  const highestRevenue = [...shaped].sort((a, b) => b.revenue - a.revenue).slice(0, TOP_N);

  const eligible = shaped.filter((row) => row.leadCount >= MIN_SAMPLE_SIZE_FOR_CONVERSION_RANKING);
  const highestConverting = [...eligible].sort((a, b) => b.conversionRate - a.conversionRate).slice(0, TOP_N);
  const lowestConverting = [...eligible].sort((a, b) => a.conversionRate - b.conversionRate).slice(0, TOP_N);

  return { mostRequested, highestRevenue, highestConverting, lowestConverting };
}

// ---------------------------------------------------------------------------
// Customer value analytics
// ---------------------------------------------------------------------------

export interface CustomerWonTimeline {
  customerId: string;
  customerName: string | null;
  /** Epoch milliseconds of every won lead's wonAt, ascending. */
  wonAtTimestamps: number[];
}

export interface FastestReturningCustomer {
  customerId: string;
  customerName: string | null;
  averageDaysBetweenWins: number;
}

const MS_PER_DAY = 86_400_000;

/** Only customers with 2+ won leads have a "gap between wins" at all — a customer who's won once has no return speed to measure yet. */
export function computeFastestReturningCustomers(customers: CustomerWonTimeline[], limit = TOP_N): FastestReturningCustomer[] {
  const withGaps = customers
    .filter((c) => c.wonAtTimestamps.length >= 2)
    .map((c) => {
      const gaps: number[] = [];
      for (let i = 1; i < c.wonAtTimestamps.length; i += 1) {
        gaps.push((c.wonAtTimestamps[i]! - c.wonAtTimestamps[i - 1]!) / MS_PER_DAY);
      }
      const averageDaysBetweenWins = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
      return { customerId: c.customerId, customerName: c.customerName, averageDaysBetweenWins };
    });

  return withGaps.sort((a, b) => a.averageDaysBetweenWins - b.averageDaysBetweenWins).slice(0, limit);
}

export interface CustomerLastActivity {
  customerId: string;
  customerName: string | null;
  /** Epoch milliseconds of the customer's most recent lead (any status). */
  lastActivityAt: number;
}

export interface LongestInactiveCustomer {
  customerId: string;
  customerName: string | null;
  daysSinceLastActivity: number;
}

/** Only ranks customers who have at least one lead on record — a customer Chakusa has never engaged isn't "inactive," they're simply unengaged, a different (and here, unmeasured) thing. */
export function computeLongestInactiveCustomers(customers: CustomerLastActivity[], now: number, limit = TOP_N): LongestInactiveCustomer[] {
  return customers
    .map((c) => ({ customerId: c.customerId, customerName: c.customerName, daysSinceLastActivity: Math.floor((now - c.lastActivityAt) / MS_PER_DAY) }))
    .sort((a, b) => b.daysSinceLastActivity - a.daysSinceLastActivity)
    .slice(0, limit);
}
