import { prisma } from "../../lib/prisma.js";
import { LEAD_SOURCE_MISSED_CALL } from "../../lib/leadSources.js";

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
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
    respondedLeads,
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
    prisma.lead.findMany({
      where: { businessId, missedCallTime: { not: null }, contactedAt: { not: null } },
      select: { missedCallTime: true, contactedAt: true },
    }),
  ]);

  const totalLeads = newLeads + contactedLeads + bookedLeads + wonLeads + lostLeads;
  const conversionRate = totalLeads > 0 ? wonLeads / totalLeads : 0;
  const contactRate = totalLeads > 0 ? (contactedLeads + bookedLeads + wonLeads + lostLeads) / totalLeads : 0;

  const responseTimesSeconds = respondedLeads
    .filter((lead) => lead.missedCallTime && lead.contactedAt)
    .map((lead) => (lead.contactedAt!.getTime() - lead.missedCallTime!.getTime()) / 1000);
  const averageResponseTimeSeconds =
    responseTimesSeconds.length > 0
      ? responseTimesSeconds.reduce((sum, s) => sum + s, 0) / responseTimesSeconds.length
      : null;

  const wonLeadRecords = await prisma.lead.findMany({
    where: { businessId, status: "won", estimatedValue: { not: null } },
    select: { estimatedValue: true, source: true },
  });

  const missedCallRecoveredRevenue = wonLeadRecords
    .filter((lead) => lead.source === LEAD_SOURCE_MISSED_CALL)
    .reduce((sum, lead) => sum + Number(lead.estimatedValue), 0);

  const totalRecoveredRevenue = wonLeadRecords.reduce(
    (sum, lead) => sum + Number(lead.estimatedValue),
    0,
  );

  const comebackWonReminders = await prisma.reminder.count({
    where: { businessId, status: "completed" },
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
      sampleSize: responseTimesSeconds.length,
    },
    recentActivity,
    todayAttentionItems: attentionItems,
    generatedAt: new Date(),
    windowStart: today,
  };
}
