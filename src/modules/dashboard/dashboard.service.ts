import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL } from "../../lib/leadSources.js";
import { computeBusinessHealth } from "../../lib/businessHealth.js";
import { computeBusinessProfileCompleteness } from "../../lib/businessProfileCompleteness.js";
import { computeCustomerIntelligence, type CustomerNeedingFollowUp } from "../../lib/customerIntelligence.js";
import { generateRecommendations } from "../../lib/recommendations.js";
import { customersDueForReviewRequest } from "../reviews/reviews.service.js";
import { startOfCurrentUtcMonth } from "../../lib/entitlements.js";

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Average response time in seconds, computed entirely in SQL (AVG over the
 * per-row EXTRACT(EPOCH FROM contacted_at - missed_call_time)) — see the
 * P0 scale fix below for why this replaced a Node-side findMany/reduce.
 * businessId is passed as a bound parameter (Prisma.sql``'s tagged
 * template), never string-interpolated, so this carries no injection risk
 * despite being raw SQL.
 */
async function getAverageResponseTime(businessId: string): Promise<{ averageSeconds: number | null; sampleSize: number }> {
  const rows = await prisma.$queryRaw<{ avg_seconds: number | null; sample_size: bigint }[]>(Prisma.sql`
    SELECT
      AVG(EXTRACT(EPOCH FROM (contacted_at - missed_call_time))) AS avg_seconds,
      COUNT(*) AS sample_size
    FROM leads
    WHERE business_id = ${businessId}
      AND missed_call_time IS NOT NULL
      AND contacted_at IS NOT NULL
  `);
  const row = rows[0];
  return {
    averageSeconds: row?.avg_seconds != null ? Number(row.avg_seconds) : null,
    sampleSize: row ? Number(row.sample_size) : 0,
  };
}

/** Sum of (won_at - created_at) in days across won leads with both timestamps, and the sample it's averaged over — SQL-side for the same scale reason as getAverageResponseTime. */
async function getRecoveryDaysAggregate(businessId: string): Promise<{ totalDays: number; sampleSize: number }> {
  const rows = await prisma.$queryRaw<{ total_days: number | null; sample_size: bigint }[]>(Prisma.sql`
    SELECT
      SUM(EXTRACT(EPOCH FROM (won_at - created_at)) / 86400) AS total_days,
      COUNT(*) AS sample_size
    FROM leads
    WHERE business_id = ${businessId}
      AND status = 'won'
      AND won_at IS NOT NULL
  `);
  const row = rows[0];
  return { totalDays: row?.total_days != null ? Number(row.total_days) : 0, sampleSize: row ? Number(row.sample_size) : 0 };
}

export async function getDashboardSummary(businessId: string) {
  const today = startOfDay(new Date());

  const [
    totalMissedCalls,
    newLeads,
    contactedLeads,
    bookedLeads,
    wonLeads,
    lostLeads,
    reviewRequestsSent,
    reviewsReceived,
    feedbackReceived,
    customersDue,
    recentActivity,
    dueReminders,
    responseTime,
    totalRecoveredAggregate,
    missedCallRecoveredAggregate,
    comebackWonReminders,
    outstandingRevenueRows,
    appointmentPaymentRows,
    business,
    totalCustomers,
    newCustomersThisPeriod,
    wonLeadCountRows,
    recoveryDays,
    newLeadCustomers,
    dueReminderCustomers,
    customersDueForReview,
  ] = await Promise.all([
    prisma.lead.count({ where: { businessId, source: LEAD_SOURCE_MISSED_CALL } }),
    prisma.lead.count({ where: { businessId, status: "new" } }),
    prisma.lead.count({ where: { businessId, status: "contacted" } }),
    prisma.lead.count({ where: { businessId, status: "booked" } }),
    prisma.lead.count({ where: { businessId, status: "won" } }),
    prisma.lead.count({ where: { businessId, status: "lost" } }),
    prisma.reviewRequest.count({ where: { businessId, status: { in: ["sent", "opened", "reviewed", "feedback_received"] } } }),
    prisma.reviewRequest.count({ where: { businessId, status: "reviewed" } }),
    prisma.feedback.count({ where: { businessId } }),
    // customersDue counts DUE REMINDER ROWS, not distinct customers. A
    // customer with two overdue reminders is counted twice. Do not treat
    // this as "number of customers who need attention" without changing
    // the query to a distinct customerId count.
    prisma.reminder.count({ where: { businessId, status: "due", dueDate: { lte: new Date() } } }),
    prisma.activityEvent.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.reminder.findMany({
      where: { businessId, status: "due", dueDate: { lte: new Date() } },
      orderBy: { dueDate: "asc" },
      take: 10,
      include: { customer: true },
    }),
    // P0 scale fix: previously two separate prisma.lead.findMany() calls
    // loaded every matching row into Node just to sum/average in
    // JavaScript — both queries grew unbounded with a business's all-time
    // lead history. Both are now SQL-side aggregates (COUNT/AVG/SUM), so
    // the response time and cost of this endpoint no longer scales with
    // how many leads a business has ever had.
    getAverageResponseTime(businessId),
    prisma.lead.aggregate({
      where: { businessId, status: "won", estimatedValue: { not: null } },
      _sum: { estimatedValue: true },
    }),
    prisma.lead.aggregate({
      where: { businessId, status: "won", estimatedValue: { not: null }, source: LEAD_SOURCE_MISSED_CALL },
      _sum: { estimatedValue: true },
    }),
    prisma.reminder.count({ where: { businessId, status: "completed" } }),
    // Won leads not yet fully paid, netting out any recorded partial
    // payment — "money you're owed right now," not a payment rail. SQL-side
    // for the same scale reason as getAverageResponseTime above.
    prisma.$queryRaw<{ outstanding: string | null }[]>(Prisma.sql`
      SELECT SUM(estimated_value - COALESCE(paid_amount, 0)) AS outstanding
      FROM leads
      WHERE business_id = ${businessId}
        AND status = 'won'
        AND payment_status != 'paid'
        AND estimated_value IS NOT NULL
    `),
    prisma.$queryRaw<{ collected: string | null; outstanding: string | null }[]>(Prisma.sql`
      SELECT SUM(paid_amount) AS collected,
             SUM(GREATEST(COALESCE(price, 0) - paid_amount, 0)) AS outstanding
      FROM appointments
      WHERE business_id = ${businessId} AND status != 'CANCELED'
    `),
    prisma.business.findUnique({
      where: { id: businessId },
      select: { industry: true, phone: true, description: true, defaultServices: true, workingHours: true, googleReviewLink: true },
    }),
    prisma.customer.count({ where: { businessId } }),
    prisma.customer.count({ where: { businessId, createdAt: { gte: startOfCurrentUtcMonth() } } }),
    prisma.lead.groupBy({
      by: ["customerId"],
      where: { businessId, status: "won", customerId: { not: null } },
      _count: { _all: true },
      _sum: { estimatedValue: true },
    }),
    getRecoveryDaysAggregate(businessId),
    // "Needing follow-up" — a customer with a new (never-contacted) lead.
    // distinct() keeps this a customer-level list even if a customer
    // somehow has more than one new lead at once.
    prisma.lead.findMany({
      where: { businessId, status: "new", customerId: { not: null } },
      select: { customerId: true, customer: { select: { name: true } } },
      distinct: ["customerId"],
    }),
    prisma.reminder.findMany({
      where: { businessId, status: "due", dueDate: { lte: new Date() }, customerId: { not: null } },
      select: { customerId: true, customer: { select: { name: true } } },
      distinct: ["customerId"],
    }),
    customersDueForReviewRequest(businessId),
  ]);

  const totalLeads = newLeads + contactedLeads + bookedLeads + wonLeads + lostLeads;
  const conversionRate = totalLeads > 0 ? wonLeads / totalLeads : 0;
  const contactRate = totalLeads > 0 ? (contactedLeads + bookedLeads + wonLeads + lostLeads) / totalLeads : 0;

  const averageResponseTimeSeconds = responseTime.averageSeconds;
  const responseTimesSampleSize = responseTime.sampleSize;

  const totalRecoveredRevenue = Number(totalRecoveredAggregate._sum.estimatedValue ?? 0);
  const missedCallRecoveredRevenue = Number(missedCallRecoveredAggregate._sum.estimatedValue ?? 0);
  const outstandingRevenue = Number(outstandingRevenueRows[0]?.outstanding ?? 0);
  const appointmentCollected = Number(appointmentPaymentRows[0]?.collected ?? 0);
  const appointmentOutstanding = Number(appointmentPaymentRows[0]?.outstanding ?? 0);

  const workingHoursSummary = (() => {
    const summary = (business?.workingHours as Record<string, unknown> | null)?.summary;
    return typeof summary === "string" ? summary : null;
  })();
  const profileCompleteness = computeBusinessProfileCompleteness({
    industry: business?.industry ?? null,
    phone: business?.phone ?? null,
    description: business?.description ?? null,
    defaultServices: business?.defaultServices ?? null,
    workingHoursSummary: workingHoursSummary,
    googleReviewLink: business?.googleReviewLink ?? null,
  });
  const paymentCollectionRate = totalRecoveredRevenue > 0 ? (totalRecoveredRevenue - outstandingRevenue) / totalRecoveredRevenue : null;

  const businessHealth = computeBusinessHealth({
    totalLeads,
    contactRate,
    conversionRate,
    reviewRequestsSent,
    reviewsReceived,
    comebackCompletedCount: comebackWonReminders,
    customersDue,
    profileCompleteness,
    paymentCollectionRate,
  });

  // A customer with both a new lead AND a due reminder is merged into one
  // entry (new_lead takes priority as the more time-sensitive reason) —
  // this is a customer-level list, never double-counting the same person.
  const needingFollowUpMap = new Map<string, CustomerNeedingFollowUp>();
  for (const lead of newLeadCustomers) {
    if (!lead.customerId) continue;
    needingFollowUpMap.set(lead.customerId, { customerId: lead.customerId, customerName: lead.customer?.name ?? null, reason: "new_lead" });
  }
  for (const reminder of dueReminderCustomers) {
    if (!reminder.customerId || needingFollowUpMap.has(reminder.customerId)) continue;
    needingFollowUpMap.set(reminder.customerId, { customerId: reminder.customerId, customerName: reminder.customer?.name ?? null, reason: "comeback_due" });
  }
  const needingFollowUpAll = [...needingFollowUpMap.values()];

  const customerIntelligence = computeCustomerIntelligence({
    totalCustomers,
    newCustomersThisPeriod,
    wonLeadCountsByCustomer: wonLeadCountRows
      .filter((row): row is typeof row & { customerId: string } => row.customerId != null)
      .map((row) => ({
        customerId: row.customerId,
        wonLeadCount: row._count._all,
        lifetimeValue: Number(row._sum.estimatedValue ?? 0),
      })),
    recoveryDaysTotal: recoveryDays.totalDays,
    recoveryDaysSampleSize: recoveryDays.sampleSize,
    needingFollowUp: needingFollowUpAll.slice(0, 8),
    needingFollowUpTotalCount: needingFollowUpAll.length,
  });

  const recommendations = generateRecommendations({
    needingFollowUpCount: needingFollowUpAll.length,
    customersDueForReviewRequestCount: customersDueForReview.length,
    outstandingRevenue,
    customersDue,
    profileCompleteness,
  });

  const attentionItems = [
    ...dueReminders.map((r) => ({
      type: "reminder_due" as const,
      id: r.id,
      customerName: r.customer?.name ?? null,
      dueDate: r.dueDate,
    })),
  ];

  return {
    recoveredRevenue: {
      total: totalRecoveredRevenue,
      missedCall: missedCallRecoveredRevenue,
      comebackCompletedCount: comebackWonReminders,
      // Won leads still marked unpaid/partially_paid, net of any recorded
      // partial payment — see LeadPaymentStatus's schema comment. Zero for
      // businesses that never use payment tracking, so this is purely
      // additive to existing dashboard consumers.
      outstanding: outstandingRevenue,
      appointmentCollected,
      appointmentOutstanding,
    },
    leads: {
      missedCalls: totalMissedCalls,
      new: newLeads,
      contacted: contactedLeads,
      booked: bookedLeads,
      won: wonLeads,
      lost: lostLeads,
      total: totalLeads,
      conversionRate,
      contactRate,
    },
    reviews: {
      requestsSent: reviewRequestsSent,
      reviewsReceived,
      feedbackReceived,
    },
    // Count of due reminder rows (not distinct customers) — see comment above.
    customersDue,
    responseTime: {
      averageSeconds: averageResponseTimeSeconds,
      sampleSize: responseTimesSampleSize,
    },
    recentActivity,
    todayAttentionItems: attentionItems,
    businessHealth,
    customerIntelligence,
    recommendations,
    generatedAt: new Date(),
    windowStart: today,
  };
}
