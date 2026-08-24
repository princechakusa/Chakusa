import { prisma } from "../../lib/prisma.js";
import { getDashboardSummary } from "./dashboard.service.js";
import { getBusinessInsights } from "./insights.service.js";
import { getAudienceSummaries } from "../customers/audiences.service.js";

export interface ValueCenterDto {
  valueCreated: {
    revenue: { collected: number; recovered: number; outstanding: number; potential: number | null };
    customers: { total: number; new: number; recovered: number; retained: number; dormant: number; dormantReturned: number | null };
    appointments: { booked: number; completed: number; cancelled: number | null; noShows: number | null; noShowsRecovered: number | null };
    reputation: { requests: number; received: number; averageRating: number | null };
    automation: { messagesSent: number; automationsCompleted: number; followUpsCompleted: number; reminderSuccess: number | null };
  };
  automationRoi: Array<{ triggerType: string; scheduled: number; sent: number; delivered: number; opened: number | null; replied: number | null; booked: number | null; paid: number | null; revenue: number | null }>;
  opportunities: Array<{ key: string; priority: "high" | "medium"; count: number; businessImpact: number | null; suggestedAction: string; action: { kind: "attention" | "audience" | "comeback"; category?: string; audienceKey?: string } }>;
  generatedAt: Date;
}

export async function getValueCenter(businessId: string): Promise<ValueCenterDto> {
  const summary = await getDashboardSummary(businessId);
  const [insights, audiences, automationRows, messageRows, appointmentRows, ratingRow] = await Promise.all([
    getBusinessInsights(businessId, summary),
    getAudienceSummaries(businessId),
    prisma.automationRun.groupBy({ by: ["automationRuleId", "status"], where: { businessId }, _count: { _all: true }, orderBy: { automationRuleId: "asc" } }),
    prisma.message.findMany({ where: { businessId, automationRunId: { not: null } }, select: { status: true, automationRun: { select: { automationRule: { select: { triggerType: true } } } } } }),
    prisma.appointment.groupBy({ by: ["status"], where: { businessId }, _count: { _all: true } }),
    prisma.feedback.aggregate({ where: { businessId }, _avg: { rating: true } }),
  ]);
  const rules = await prisma.automationRule.findMany({ where: { businessId, id: { in: automationRows.map((row) => row.automationRuleId) } }, select: { id: true, triggerType: true } });
  const ruleType = new Map(rules.map((rule) => [rule.id, rule.triggerType]));
  const byType = new Map<string, ValueCenterDto["automationRoi"][number]>();
  for (const row of automationRows) {
    const triggerType = ruleType.get(row.automationRuleId) ?? "unknown";
    const item = byType.get(triggerType) ?? { triggerType, scheduled: 0, sent: 0, delivered: 0, opened: null, replied: null, booked: null, paid: null, revenue: null };
    item.scheduled += row._count._all;
    if (row.status === "COMPLETED") item.sent += row._count._all;
    byType.set(triggerType, item);
  }
  // Message delivery is authoritative, but opens/replies/bookings/payments are
  // intentionally unknown because the current schema does not record those
  // events as an automation attribution chain.
  for (const message of messageRows) {
    const triggerType = message.automationRun?.automationRule.triggerType;
    const item = triggerType ? byType.get(triggerType) : undefined;
    if (!item || !triggerType) continue;
    if (message.status === "sent" || message.status === "delivered") item.sent += 1;
    if (message.status === "delivered") item.delivered += 1;
  }
  const appointmentCounts = new Map(appointmentRows.map((row) => [row.status, row._count._all]));
  const dormant = audiences.find((item) => item.key === "dormant");
  const returning = insights.customerLifecycle.counts.returning + insights.customerLifecycle.counts.loyal + insights.customerLifecycle.counts.vip;
  const opportunities: ValueCenterDto["opportunities"] = [];
  if (summary.recoveredRevenue.outstanding > 0) opportunities.push({ key: "outstanding_payment", priority: "high", count: 1, businessImpact: summary.recoveredRevenue.outstanding, suggestedAction: "Collect outstanding payments", action: { kind: "attention", category: "payment_outstanding" } });
  if (summary.leads.new > 0) opportunities.push({ key: "lead_waiting", priority: "high", count: summary.leads.new, businessImpact: null, suggestedAction: "Follow up on new leads", action: { kind: "attention", category: "missed_call_followup" } });
  if (dormant && dormant.totalCustomers > 0) opportunities.push({ key: "dormant_customers", priority: dormant.totalCustomers >= 5 ? "high" : "medium", count: dormant.totalCustomers, businessImpact: dormant.revenue, suggestedAction: "Bring dormant customers back", action: { kind: "audience", audienceKey: "dormant" } });
  if (summary.reviews.requestsSent > summary.reviews.reviewsReceived) opportunities.push({ key: "missed_review", priority: "medium", count: summary.reviews.requestsSent - summary.reviews.reviewsReceived, businessImpact: null, suggestedAction: "Complete open review requests", action: { kind: "attention", category: "review_opportunity" } });
  return {
    valueCreated: {
      // The current model has no separate potential-revenue event; keep it
      // unknown instead of presenting an estimate as business value.
      revenue: { collected: insights.revenueAttribution.totalCollected, recovered: summary.recoveredRevenue.total, outstanding: summary.recoveredRevenue.outstanding, potential: null },
      customers: { total: summary.customerIntelligence.totalCustomers, new: summary.customerIntelligence.newCustomersThisPeriod, recovered: summary.customerIntelligence.returningCustomers, retained: returning, dormant: dormant?.totalCustomers ?? 0, dormantReturned: null },
      appointments: { booked: summary.activation?.appointmentsBooked ?? 0, completed: summary.activation?.appointmentsCompleted ?? 0, cancelled: appointmentCounts.get("CANCELED") ?? null, noShows: appointmentCounts.get("NO_SHOW") ?? null, noShowsRecovered: null },
      reputation: { requests: summary.reviews.requestsSent, received: summary.reviews.reviewsReceived, averageRating: ratingRow._avg?.rating ?? null },
      automation: { messagesSent: summary.activation?.customerMessagesSent ?? 0, automationsCompleted: automationRows.filter((row) => row.status === "COMPLETED").reduce((sum, row) => sum + row._count._all, 0), followUpsCompleted: comebackCount(summary), reminderSuccess: insights.recoveryPerformance.reminderCompletionRate },
    },
    automationRoi: [...byType.values()], opportunities, generatedAt: new Date(),
  };
}

function comebackCount(summary: Awaited<ReturnType<typeof getDashboardSummary>>) { return summary.recoveredRevenue.comebackCompletedCount; }
