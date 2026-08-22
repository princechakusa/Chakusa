import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL } from "../../lib/leadSources.js";
import { getDashboardSummary } from "./dashboard.service.js";
import {
  buildMonthlyTrend,
  computeFastestReturningCustomers,
  computeLongestInactiveCustomers,
  computeServicePerformance,
  lastNMonthKeys,
  type CustomerLastActivity,
  type CustomerWonTimeline,
  type MonthlyMetricRow,
  type ServiceAggregateRow,
} from "../../lib/businessInsights.js";

const TREND_MONTHS = 6;
/** Scale safety net on the two per-customer raw queries below — final ranking/top-5 selection still happens in businessInsights.ts's pure functions, this just bounds how many candidate rows ever leave Postgres. */
const CUSTOMER_CANDIDATE_LIMIT = 500;

function monthStart(monthsAgo: number, now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 1));
}

/** Every `$queryRaw` grouped-by-month result comes back as `{ month: Date, value: bigint | number | string | null }` — this normalizes all of them to businessInsights.ts's MonthlyMetricRow shape. */
function toMonthlyRows(rows: { month: Date; value: unknown }[]): MonthlyMetricRow[] {
  return rows.map((row) => ({
    month: `${row.month.getUTCFullYear()}-${String(row.month.getUTCMonth() + 1).padStart(2, "0")}`,
    value: Number(row.value ?? 0),
  }));
}

export async function getBusinessInsights(businessId: string) {
  const now = new Date();
  const months = lastNMonthKeys(TREND_MONTHS, now);
  const windowStart = monthStart(TREND_MONTHS, now);

  const [
    // Reused entirely from the Business Health / Customer Intelligence /
    // Recommendations engine — recovery performance is measured, not
    // recomputed, from the same numbers already surfaced on the Dashboard.
    dashboardSummary,

    newLeadsRows,
    wonLeadsRows,
    newCustomersRows,
    returningCustomersRows,
    recoveredRevenueRows,
    reviewRequestsSentRows,
    reviewsReceivedRows,
    remindersCompletedRows,

    serviceRows,
    customerWonTimelineRows,
    customerLastActivityRows,
    missedCallsRecoveredCount,
  ] = await Promise.all([
    getDashboardSummary(businessId),

    prisma.$queryRaw<{ month: Date; value: bigint }[]>(Prisma.sql`
      SELECT date_trunc('month', created_at) AS month, COUNT(*) AS value
      FROM leads WHERE business_id = ${businessId} AND created_at >= ${windowStart}
      GROUP BY 1
    `),
    // Bucketed by created_at (not won_at) — this pairs with newLeadsRows to
    // answer "of leads created in month M, what fraction are won today,"
    // the same definition buildMonthlyTrend's conversionRate documents.
    prisma.$queryRaw<{ month: Date; value: bigint }[]>(Prisma.sql`
      SELECT date_trunc('month', created_at) AS month, COUNT(*) AS value
      FROM leads WHERE business_id = ${businessId} AND created_at >= ${windowStart} AND status = 'won'
      GROUP BY 1
    `),
    prisma.$queryRaw<{ month: Date; value: bigint }[]>(Prisma.sql`
      SELECT date_trunc('month', created_at) AS month, COUNT(*) AS value
      FROM customers WHERE business_id = ${businessId} AND created_at >= ${windowStart}
      GROUP BY 1
    `),
    // A customer "becomes returning" in the month their 2nd (or later) won
    // lead closed — ranked per customer by won_at, filtered to rank >= 2.
    prisma.$queryRaw<{ month: Date; value: bigint }[]>(Prisma.sql`
      WITH ranked AS (
        SELECT customer_id, won_at, ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY won_at) AS rn
        FROM leads
        WHERE business_id = ${businessId} AND status = 'won' AND customer_id IS NOT NULL AND won_at IS NOT NULL
      )
      SELECT date_trunc('month', won_at) AS month, COUNT(DISTINCT customer_id) AS value
      FROM ranked WHERE rn >= 2 AND won_at >= ${windowStart}
      GROUP BY 1
    `),
    // Bucketed by won_at (the month the deal actually closed) — distinct
    // from newLeads/wonLeads above, which bucket by when the lead was
    // first created.
    prisma.$queryRaw<{ month: Date; value: string | null }[]>(Prisma.sql`
      SELECT date_trunc('month', won_at) AS month, SUM(estimated_value) AS value
      FROM leads WHERE business_id = ${businessId} AND won_at >= ${windowStart} AND status = 'won' AND estimated_value IS NOT NULL
      GROUP BY 1
    `),
    prisma.$queryRaw<{ month: Date; value: bigint }[]>(Prisma.sql`
      SELECT date_trunc('month', created_at) AS month, COUNT(*) AS value
      FROM review_requests
      WHERE business_id = ${businessId} AND created_at >= ${windowStart} AND status IN ('sent','opened','reviewed','feedback_received')
      GROUP BY 1
    `),
    // No dedicated "reviewedAt" column exists on ReviewRequest — updated_at
    // is the best real proxy for "when this was marked reviewed" (it only
    // changes via an explicit status transition), documented here rather
    // than silently assumed.
    prisma.$queryRaw<{ month: Date; value: bigint }[]>(Prisma.sql`
      SELECT date_trunc('month', updated_at) AS month, COUNT(*) AS value
      FROM review_requests WHERE business_id = ${businessId} AND updated_at >= ${windowStart} AND status = 'reviewed'
      GROUP BY 1
    `),
    // Same updated_at proxy as above — Reminder has no dedicated completedAt column either.
    prisma.$queryRaw<{ month: Date; value: bigint }[]>(Prisma.sql`
      SELECT date_trunc('month', updated_at) AS month, COUNT(*) AS value
      FROM reminders WHERE business_id = ${businessId} AND updated_at >= ${windowStart} AND status = 'completed'
      GROUP BY 1
    `),

    prisma.$queryRaw<{ service: string; lead_count: bigint; won_count: bigint; revenue: string | null }[]>(Prisma.sql`
      SELECT service_requested AS service, COUNT(*) AS lead_count,
             COUNT(*) FILTER (WHERE status = 'won') AS won_count,
             COALESCE(SUM(estimated_value) FILTER (WHERE status = 'won'), 0) AS revenue
      FROM leads
      WHERE business_id = ${businessId} AND service_requested IS NOT NULL AND service_requested != ''
      GROUP BY service_requested
    `),
    prisma.$queryRaw<{ customer_id: string; customer_name: string; won_at_list: Date[] }[]>(Prisma.sql`
      SELECT l.customer_id, c.name AS customer_name, array_agg(l.won_at ORDER BY l.won_at) AS won_at_list
      FROM leads l JOIN customers c ON c.id = l.customer_id
      WHERE l.business_id = ${businessId} AND l.status = 'won' AND l.customer_id IS NOT NULL AND l.won_at IS NOT NULL
      GROUP BY l.customer_id, c.name
      HAVING COUNT(*) >= 2
      LIMIT ${CUSTOMER_CANDIDATE_LIMIT}
    `),
    prisma.$queryRaw<{ customer_id: string; customer_name: string; last_activity_at: Date }[]>(Prisma.sql`
      SELECT l.customer_id, c.name AS customer_name, MAX(l.created_at) AS last_activity_at
      FROM leads l JOIN customers c ON c.id = l.customer_id
      WHERE l.business_id = ${businessId}
      GROUP BY l.customer_id, c.name
      ORDER BY last_activity_at ASC
      LIMIT ${CUSTOMER_CANDIDATE_LIMIT}
    `),
    // How many missed calls actually turned into a paying customer — a
    // genuinely new count, not already surfaced elsewhere (dashboard.summary
    // only has the missed-call lead total and the revenue from won ones,
    // not this count).
    prisma.lead.count({ where: { businessId, source: LEAD_SOURCE_MISSED_CALL, status: "won" } }),
  ]);

  const monthlyTrend = buildMonthlyTrend(months, {
    newLeads: toMonthlyRows(newLeadsRows),
    wonLeads: toMonthlyRows(wonLeadsRows),
    newCustomers: toMonthlyRows(newCustomersRows),
    returningCustomers: toMonthlyRows(returningCustomersRows),
    recoveredRevenue: toMonthlyRows(recoveredRevenueRows),
    reviewRequestsSent: toMonthlyRows(reviewRequestsSentRows),
    reviewsReceived: toMonthlyRows(reviewsReceivedRows),
    remindersCompleted: toMonthlyRows(remindersCompletedRows),
  });

  const serviceAggregateRows: ServiceAggregateRow[] = serviceRows.map((row) => ({
    service: row.service,
    leadCount: Number(row.lead_count),
    wonCount: Number(row.won_count),
    revenue: Number(row.revenue ?? 0),
  }));
  const servicePerformance = computeServicePerformance(serviceAggregateRows);

  const customerWonTimelines: CustomerWonTimeline[] = customerWonTimelineRows.map((row) => ({
    customerId: row.customer_id,
    customerName: row.customer_name,
    wonAtTimestamps: row.won_at_list.map((d) => new Date(d).getTime()),
  }));
  const fastestReturningCustomers = computeFastestReturningCustomers(customerWonTimelines);

  const customerLastActivity: CustomerLastActivity[] = customerLastActivityRows.map((row) => ({
    customerId: row.customer_id,
    customerName: row.customer_name,
    lastActivityAt: new Date(row.last_activity_at).getTime(),
  }));
  const longestInactiveCustomers = computeLongestInactiveCustomers(customerLastActivity, now.getTime());

  // Recovery performance is entirely reused, not recomputed — every figure
  // here is already the authoritative one shown elsewhere (Dashboard,
  // Business Health), just labeled for this screen.
  const comebackCompletionFactor = dashboardSummary.businessHealth.factors.find((f) => f.key === "comebackCompletion");
  const recoveryPerformance = {
    missedCallsRecovered: missedCallsRecoveredCount,
    missedCallsTotal: dashboardSummary.leads.missedCalls,
    recoverySuccessRate: dashboardSummary.leads.contactRate,
    recoveryConversionRate: dashboardSummary.leads.conversionRate,
    reviewRequestSuccessRate:
      dashboardSummary.reviews.requestsSent > 0 ? dashboardSummary.reviews.reviewsReceived / dashboardSummary.reviews.requestsSent : null,
    reminderCompletionRate: comebackCompletionFactor?.included ? comebackCompletionFactor.value! / 100 : null,
    averageRecoveryDays: dashboardSummary.customerIntelligence.averageRecoveryDays,
  };

  return {
    monthlyTrend,
    servicePerformance,
    customerValue: {
      fastestReturningCustomers,
      longestInactiveCustomers,
      atRiskCustomers: dashboardSummary.customerIntelligence.needingFollowUp.filter((c) => c.reason === "comeback_due"),
      repeatCustomers: dashboardSummary.customerIntelligence.topCustomersByValue,
    },
    recoveryPerformance,
    generatedAt: now,
    windowStart,
  };
}
