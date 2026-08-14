import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL } from "../../lib/leadSources.js";

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
  ]);

  const totalLeads = newLeads + contactedLeads + bookedLeads + wonLeads + lostLeads;
  const conversionRate = totalLeads > 0 ? wonLeads / totalLeads : 0;
  const contactRate = totalLeads > 0 ? (contactedLeads + bookedLeads + wonLeads + lostLeads) / totalLeads : 0;

  const averageResponseTimeSeconds = responseTime.averageSeconds;
  const responseTimesSampleSize = responseTime.sampleSize;

  const totalRecoveredRevenue = Number(totalRecoveredAggregate._sum.estimatedValue ?? 0);
  const missedCallRecoveredRevenue = Number(missedCallRecoveredAggregate._sum.estimatedValue ?? 0);

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
    generatedAt: new Date(),
    windowStart: today,
  };
}
