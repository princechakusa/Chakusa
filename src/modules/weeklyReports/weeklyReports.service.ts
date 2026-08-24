import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { sendPushToUser } from "../../lib/push/pushService.js";
import type { PushProvider } from "../../lib/push/pushProvider.js";
import { sendWeeklyOwnerReportEmail } from "./weeklyReportEmail.js";

const DAY_MS = 86_400_000;
export interface WeeklyReportSummary { appointmentsCompleted: number; appointmentsBooked: number; collectedRevenue: number; revenueRecovered: number; customersReturned: number; outstandingRevenue: number; automationSuccessRate: number | null; topOpportunity: string | null; highestRisk: string | null; newCustomers: number; newLeads: number; wonLeads: number; customerMessagesSent: number; reviewsReceived: number; }

function localWeek(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  const localDate = new Date(`${value("year")}-${value("month")}-${value("day")}T00:00:00.000Z`);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value("weekday"));
  const currentMonday = new Date(localDate.getTime() - ((weekday + 6) % 7) * DAY_MS);
  return { localHour: Number(value("hour")), weekKey: currentMonday.toISOString().slice(0, 10), periodEnd: currentMonday, periodStart: new Date(currentMonday.getTime() - 7 * DAY_MS) };
}

export async function buildWeeklyReportSummary(businessId: string, periodStart: Date, periodEnd: Date): Promise<WeeklyReportSummary> {
  const [appointmentsCompleted, appointmentsBooked, revenue, recovered, returned, outstanding, automation, newCustomers, newLeads, wonLeads, customerMessagesSent, reviewsReceived] = await Promise.all([
    prisma.appointment.count({ where: { businessId, status: "COMPLETED", endsAt: { gte: periodStart, lt: periodEnd } } }),
    prisma.appointment.count({ where: { businessId, createdAt: { gte: periodStart, lt: periodEnd } } }),
    prisma.appointment.aggregate({ where: { businessId, status: { not: "CANCELED" }, updatedAt: { gte: periodStart, lt: periodEnd } }, _sum: { paidAmount: true } }),
    prisma.lead.aggregate({ where: { businessId, status: "won", wonAt: { gte: periodStart, lt: periodEnd }, estimatedValue: { not: null } }, _sum: { estimatedValue: true } }),
    prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(*) AS count FROM (SELECT customer_id FROM leads WHERE business_id = ${businessId} AND status = 'won' AND customer_id IS NOT NULL AND won_at >= ${periodStart} AND won_at < ${periodEnd} GROUP BY customer_id HAVING COUNT(*) >= 2) returning_customers`),
    prisma.$queryRaw<{ outstanding: string | null }[]>(Prisma.sql`SELECT SUM(GREATEST(estimated_value - COALESCE(paid_amount, 0), 0)) AS outstanding FROM leads WHERE business_id = ${businessId} AND status = 'won' AND payment_status != 'paid' AND estimated_value IS NOT NULL`),
    prisma.$queryRaw<{ completed: bigint; terminal: bigint }[]>(Prisma.sql`SELECT COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed, COUNT(*) FILTER (WHERE status IN ('COMPLETED','FAILED','CANCELLED')) AS terminal FROM automation_runs WHERE business_id = ${businessId} AND updated_at >= ${periodStart} AND updated_at < ${periodEnd}`),
    prisma.customer.count({ where: { businessId, createdAt: { gte: periodStart, lt: periodEnd } } }),
    prisma.lead.count({ where: { businessId, createdAt: { gte: periodStart, lt: periodEnd } } }),
    prisma.lead.count({ where: { businessId, status: "won", wonAt: { gte: periodStart, lt: periodEnd } } }),
    prisma.message.count({ where: { businessId, status: { in: ["sent", "delivered"] }, sentAt: { gte: periodStart, lt: periodEnd } } }),
    prisma.reviewRequest.count({ where: { businessId, status: "reviewed", updatedAt: { gte: periodStart, lt: periodEnd } } }),
  ]);
  const outstandingRevenue = Number(outstanding[0]?.outstanding ?? 0);
  const automationTerminal = Number(automation[0]?.terminal ?? 0);
  const topOpportunity = outstandingRevenue > 0 ? "Collect outstanding payments" : newLeads > 0 ? "Follow up on new leads" : reviewsReceived < wonLeads ? "Complete open review requests" : null;
  const highestRisk = outstandingRevenue > 0 ? "Outstanding revenue" : appointmentsCompleted === 0 && appointmentsBooked > 0 ? "Booked appointments not completed" : null;
  return { appointmentsCompleted, appointmentsBooked, collectedRevenue: Number(revenue._sum.paidAmount ?? 0), revenueRecovered: Number(recovered._sum.estimatedValue ?? 0), customersReturned: Number(returned[0]?.count ?? 0), outstandingRevenue, automationSuccessRate: automationTerminal > 0 ? Number(automation[0]?.completed ?? 0) / automationTerminal : null, topOpportunity, highestRisk, newCustomers, newLeads, wonLeads, customerMessagesSent, reviewsReceived };
}

export async function generateDueWeeklyOwnerReports(now = new Date(), batchSize = 50, pushProvider?: PushProvider) {
  const businesses = await prisma.business.findMany({ where: { platformStatus: "ACTIVE" }, select: { id: true, ownerId: true, name: true, timezone: true, owner: { select: { email: true } } }, take: batchSize, orderBy: { createdAt: "asc" } });
  let generated = 0;
  for (const business of businesses) {
    const week = localWeek(now, business.timezone || "UTC");
    if (week.localHour < 8) continue;
    const exists = await prisma.weeklyOwnerReport.findUnique({ where: { businessId_weekKey: { businessId: business.id, weekKey: week.weekKey } }, select: { id: true } });
    if (exists) continue;
    const summary = await buildWeeklyReportSummary(business.id, week.periodStart, week.periodEnd);
    await prisma.weeklyOwnerReport.create({ data: { businessId: business.id, weekKey: week.weekKey, periodStart: week.periodStart, periodEnd: week.periodEnd, summary: summary as unknown as Prisma.InputJsonValue } });
    // In-app report delivery is durable in WeeklyOwnerReport; push is a
    // best-effort wake-up that never prevents the report from being stored.
    await sendPushToUser(business.ownerId, { title: `${business.name} weekly report`, body: `${summary.appointmentsBooked} bookings, ${summary.appointmentsCompleted} completed, and ${summary.customerMessagesSent} customer messages this week.`, data: { type: "weekly_owner_report", weekKey: week.weekKey } }, pushProvider).catch(() => undefined);
    await sendWeeklyOwnerReportEmail(business.owner.email, business.name, week.weekKey, summary);
    generated += 1;
  }
  return { generated };
}

export async function listWeeklyOwnerReports(businessId: string) {
  const reports = await prisma.weeklyOwnerReport.findMany({ where: { businessId }, orderBy: { periodEnd: "desc" }, take: 12 });
  const unseen = reports.filter(report => !report.viewedAt).map(report => report.id);
  if (unseen.length) await prisma.weeklyOwnerReport.updateMany({ where: { businessId, id: { in: unseen } }, data: { viewedAt: new Date() } });
  return reports;
}
