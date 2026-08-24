import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { workerHeartbeatHealthy } from "../../worker/workerHeartbeat.js";
import { ApiError } from "../../lib/errors.js";
import type {
  AdminAuditListQuery,
  AdminAnalyticsQuery,
  AdminAutomationListQuery,
  AdminBusinessListQuery,
  AdminCommunicationListQuery,
  AdminDashboardQuery,
  AdminFeedbackListQuery,
  AdminSubscriptionListQuery,
  AdminSupportListQuery,
  AdminUserListQuery,
} from "./adminRead.schemas.js";

const pageEnvelope = <T>(items: T[], total: number, page: number, pageSize: number) => ({ items, total, page, pageSize });
const pageArgs = (page: number, pageSize: number) => ({ skip: (page - 1) * pageSize, take: pageSize });
const startOfUtcDay = (date = new Date()) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

function automationFailureCategory(errorMessage: string | null) {
  if (!errorMessage) return "unknown";
  if (errorMessage.includes("valid E.164")) return "invalid_phone";
  if (errorMessage.includes("opted out")) return "customer_opted_out";
  if (errorMessage.includes("entitled")) return "subscription_inactive";
  if (errorMessage.includes("rule no longer") || errorMessage.includes("disabled")) return "rule_disabled";
  if (errorMessage.includes("already been actioned") || errorMessage.includes("status changed")) return "entity_state_changed";
  if (errorMessage.includes("provider") || errorMessage.includes("attempt")) return "provider_failure";
  return "system_failure";
}

function executionTimeMs(startedAt: Date | null, completedAt: Date | null) {
  return startedAt && completedAt ? Math.max(0, completedAt.getTime() - startedAt.getTime()) : null;
}

export async function getAdminDashboard(query: AdminDashboardQuery) {
  const now = new Date();
  const today = startOfUtcDay(now);
  const windowStart = new Date(now.getTime() - query.days * 86_400_000);

  const [
    totalBusinesses,
    newBusinessesToday,
    recentlyActiveRows,
    totalCustomers,
    totalLeads,
    recoveredLeads,
    recoveredRevenue,
    totalAutomationRuns,
    completedAutomationRuns,
    failedAutomationRuns,
    queuedAutomationRuns,
    reviewRequests,
    reviewsReceived,
    averageRating,
    activeSubscriptions,
    subscriptionPlans,
    subscriptionStatuses,
    failedAppointmentPayments,
    recentSignups,
    recentActivity,
    recentAutomationFailures,
    recentSupportActivity,
    workerHeartbeat,
  ] = await Promise.all([
    prisma.business.count(),
    prisma.business.count({ where: { createdAt: { gte: today } } }),
    prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT business_id) AS count
      FROM activity_events
      WHERE created_at >= ${windowStart}
    `),
    prisma.customer.count(),
    prisma.lead.count(),
    prisma.lead.count({ where: { status: "won" } }),
    prisma.lead.aggregate({ where: { status: "won" }, _sum: { estimatedValue: true } }),
    prisma.automationRun.count(),
    prisma.automationRun.count({ where: { status: "COMPLETED" } }),
    prisma.automationRun.count({ where: { status: "FAILED" } }),
    prisma.automationRun.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }),
    prisma.reviewRequest.count(),
    prisma.reviewRequest.count({ where: { status: "reviewed" } }),
    prisma.feedback.aggregate({ _avg: { rating: true }, _count: { rating: true } }),
    prisma.subscription.count({ where: { status: { in: ["ACTIVE", "TRIALING", "GRACE_PERIOD"] } } }),
    prisma.subscription.groupBy({ by: ["plan"], _count: { _all: true } }),
    prisma.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.appointmentPaymentTransaction.count({ where: { status: "failed" } }),
    prisma.business.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, name: true, industry: true, country: true, createdAt: true, owner: { select: { fullName: true, email: true } }, subscription: { select: { plan: true, status: true } } },
    }),
    prisma.activityEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, eventType: true, entityType: true, entityId: true, createdAt: true, business: { select: { id: true, name: true } }, actor: { select: { id: true, fullName: true } } },
    }),
    prisma.automationRun.findMany({
      where: { status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, createdAt: true, startedAt: true, completedAt: true, attemptCount: true, errorMessage: true, business: { select: { id: true, name: true } }, automationRule: { select: { name: true, triggerType: true } } },
    }),
    prisma.supportTicket.findMany({
      orderBy: { updatedAt: "desc" },
      take: 6,
      select: { id: true, category: true, subject: true, status: true, updatedAt: true, business: { select: { id: true, name: true } }, createdByUser: { select: { fullName: true } } },
    }),
    prisma.workerHeartbeat.findUnique({ where: { id: "automation-worker" } }),
  ]);

  const automationTerminal = completedAutomationRuns + failedAutomationRuns;
  const recentlyActiveBusinesses = Number(recentlyActiveRows[0]?.count ?? 0);
  const databaseHealthy = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);

  return {
    window: { days: query.days, startsAt: windowStart, generatedAt: now },
    metrics: {
      totalBusinesses,
      newBusinessesToday,
      recentlyActiveBusinesses,
      totalCustomers,
      totalLeads,
      recoveredLeads,
      recoveryRate: totalLeads ? recoveredLeads / totalLeads : null,
      recoveredRevenue: Number(recoveredRevenue._sum.estimatedValue ?? 0),
      totalAutomationRuns,
      queuedAutomationRuns,
      automationSuccessRate: automationTerminal ? completedAutomationRuns / automationTerminal : null,
      reviewRequests,
      reviewsReceived,
      averageRating: averageRating._avg.rating,
      ratingSampleSize: averageRating._count.rating,
      activeSubscriptions,
      failedAppointmentPayments,
      mrr: null,
      arr: null,
      activeBusinesses: null,
      dormantBusinesses: null,
    },
    breakdowns: {
      subscriptionPlans: subscriptionPlans.map((row) => ({ key: row.plan, count: row._count._all })),
      subscriptionStatuses: subscriptionStatuses.map((row) => ({ key: row.status, count: row._count._all })),
      automation: [
        { key: "COMPLETED", count: completedAutomationRuns },
        { key: "FAILED", count: failedAutomationRuns },
        { key: "QUEUED", count: queuedAutomationRuns },
      ],
    },
    recent: {
      signups: recentSignups,
      activity: recentActivity,
      automationFailures: recentAutomationFailures.map(({ errorMessage, ...run }) => ({
        ...run,
        failureCategory: automationFailureCategory(errorMessage),
        executionTimeMs: executionTimeMs(run.startedAt, run.completedAt),
      })),
      support: recentSupportActivity,
    },
    health: {
      api: "operational" as const,
      database: databaseHealthy ? "operational" as const : "unavailable" as const,
      worker: workerHeartbeatHealthy(workerHeartbeat?.lastSuccessAt ?? null) ? "operational" as const : "unavailable" as const,
      workerLastSeenAt: workerHeartbeat?.lastSuccessAt ?? null,
      errorFeed: { available: false, reason: "Sentry issue querying is not connected to the admin API" },
    },
    unavailable: {
      mrr: "No authoritative subscription price or recognized revenue is stored",
      arr: "No authoritative subscription price or recognized revenue is stored",
      activeBusinesses: "Canonical platform activity definition has not been approved",
      dormantBusinesses: "Canonical platform dormancy definition has not been approved",
    },
  };
}

export async function getAdminAnalytics(query: AdminAnalyticsQuery) {
  const now = new Date();
  const start = startOfUtcDay(new Date(now.getTime() - (query.days - 1) * 86_400_000));
  const [businesses, customers, leads, automation, subscriptions, reviews, activity] = await Promise.all([
    prisma.business.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true, country: true, industry: true, platformStatus: true } }),
    prisma.customer.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true } }),
    prisma.lead.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true, status: true, estimatedValue: true } }),
    prisma.automationRun.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.subscription.groupBy({ by: ["plan", "status"], _count: { _all: true } }),
    prisma.reviewRequest.findMany({ where: { createdAt: { gte: start } }, select: { createdAt: true, status: true } }),
    prisma.activityEvent.findMany({ where: { createdAt: { gte: start } }, select: { businessId: true, createdAt: true } }),
  ]);
  const dayKey = (date: Date) => date.toISOString().slice(0, 10);
  const days = Array.from({ length: query.days }, (_, index) => { const date = new Date(start.getTime() + index * 86_400_000); return { date: dayKey(date), businesses: 0, customers: 0, leads: 0, recoveredLeads: 0, recoveredRevenue: 0, reviews: 0 }; });
  const byDay = new Map(days.map((day) => [day.date, day]));
  for (const row of businesses) byDay.get(dayKey(row.createdAt))!.businesses += 1;
  for (const row of customers) byDay.get(dayKey(row.createdAt))!.customers += 1;
  for (const row of leads) { const day = byDay.get(dayKey(row.createdAt)); if (!day) continue; day.leads += 1; if (row.status === "won") { day.recoveredLeads += 1; day.recoveredRevenue += Number(row.estimatedValue ?? 0); } }
  for (const row of reviews) if (row.status === "reviewed" || row.status === "feedback_received") byDay.get(dayKey(row.createdAt))!.reviews += 1;
  const countries = new Map<string, number>(); const industries = new Map<string, number>();
  for (const row of businesses) { countries.set(row.country ?? "Unknown", (countries.get(row.country ?? "Unknown") ?? 0) + 1); industries.set(row.industry ?? "Unspecified", (industries.get(row.industry ?? "Unspecified") ?? 0) + 1); }
  const activeBusinessIds = new Set(activity.map((row) => row.businessId));
  return { window: { days: query.days, startsAt: start, generatedAt: now }, series: days, breakdowns: { countries: [...countries].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count), industries: [...industries].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count), automation: automation.map((row) => ({ key: row.status, count: row._count._all })), subscriptions: subscriptions.map((row) => ({ key: `${row.plan}_${row.status}`, count: row._count._all })), activeBusinesses: activeBusinessIds.size }, totals: { businesses: businesses.length, customers: customers.length, leads: leads.length, recoveredLeads: leads.filter((lead) => lead.status === "won").length, recoveredRevenue: leads.filter((lead) => lead.status === "won").reduce((sum, lead) => sum + Number(lead.estimatedValue ?? 0), 0), reviews: reviews.length } };
}

/** Commercial-beta cohort view composed from existing business-owned tables. */
export async function getAdminBetaAnalytics() {
  const now = new Date();
  const day = new Date(now.getTime() - 86_400_000);
  const week = new Date(now.getTime() - 7 * 86_400_000);
  const month = new Date(now.getTime() - 30 * 86_400_000);
  const [cohort, activeDaily, activeWeekly, activeMonthly, lifecycle, subscriptionEvents] = await Promise.all([
    prisma.$queryRaw<{ total: bigint; active: bigint; onboarding: bigint; services: bigint; customers: bigint; bookings: bigint; completed: bigint; payments: bigint; automation: bigint; review_requests: bigint; reviews: bigint; weekly_reports: bigint }[]>(Prisma.sql`
      SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE platform_status = 'ACTIVE') AS active,
        COUNT(*) FILTER (WHERE onboarding_completed_at IS NOT NULL) AS onboarding,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM service_offerings s WHERE s.business_id = b.id)) AS services,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM customers c WHERE c.business_id = b.id)) AS customers,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM appointments a WHERE a.business_id = b.id)) AS bookings,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM appointments a WHERE a.business_id = b.id AND a.status = 'COMPLETED')) AS completed,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM appointment_payment_transactions p WHERE p.business_id = b.id AND p.status IN ('paid','partially_refunded'))) AS payments,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM automation_runs r WHERE r.business_id = b.id AND r.status = 'COMPLETED')) AS automation,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM review_requests rr WHERE rr.business_id = b.id)) AS review_requests,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM feedback f WHERE f.business_id = b.id)) AS reviews,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM weekly_owner_reports w WHERE w.business_id = b.id)) AS weekly_reports
      FROM businesses b
    `),
    prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(DISTINCT business_id) AS count FROM activity_events WHERE created_at >= ${day}`),
    prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(DISTINCT business_id) AS count FROM activity_events WHERE created_at >= ${week}`),
    prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`SELECT COUNT(DISTINCT business_id) AS count FROM activity_events WHERE created_at >= ${month}`),
    prisma.$queryRaw<{ trialing: bigint; active: bigint; expired: bigint; canceled: bigint; grace: bigint }[]>(Prisma.sql`SELECT COUNT(*) FILTER (WHERE status = 'TRIALING') AS trialing, COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active, COUNT(*) FILTER (WHERE status = 'EXPIRED') AS expired, COUNT(*) FILTER (WHERE status = 'CANCELED') AS canceled, COUNT(*) FILTER (WHERE status = 'GRACE_PERIOD') AS grace FROM subscriptions`),
    prisma.subscriptionEvent.groupBy({ by: ["type"], _count: { _all: true } }),
  ]);
  const row = cohort[0];
  const total = Number(row?.total ?? 0);
  return {
    generatedAt: now,
    businesses: { totalBeta: total, active: Number(row?.active ?? 0), dailyActive: Number(activeDaily[0]?.count ?? 0), weeklyActive: Number(activeWeekly[0]?.count ?? 0), monthlyActive: Number(activeMonthly[0]?.count ?? 0), inactive: Math.max(0, total - Number(activeMonthly[0]?.count ?? 0)) },
    activation: { onboardingCompleted: Number(row?.onboarding ?? 0), firstService: Number(row?.services ?? 0), firstCustomer: Number(row?.customers ?? 0), firstBooking: Number(row?.bookings ?? 0), firstAppointmentCompleted: Number(row?.completed ?? 0), firstPaymentCollected: Number(row?.payments ?? 0), firstAutomationExecuted: Number(row?.automation ?? 0), firstReviewRequested: Number(row?.review_requests ?? 0), firstReviewReceived: Number(row?.reviews ?? 0), firstWeeklyReportGenerated: Number(row?.weekly_reports ?? 0) },
    commercial: { trialing: Number(lifecycle[0]?.trialing ?? 0), active: Number(lifecycle[0]?.active ?? 0), gracePeriod: Number(lifecycle[0]?.grace ?? 0), expired: Number(lifecycle[0]?.expired ?? 0), canceled: Number(lifecycle[0]?.canceled ?? 0), trialToPaidConversion: null, churn: null, reactivations: null, events: subscriptionEvents.map((event) => ({ type: event.type, count: event._count._all })) },
  };
}

export async function listAdminBusinesses(query: AdminBusinessListQuery) {
  const where: Prisma.BusinessWhereInput = {
    ...(query.search ? { OR: [
      { name: { contains: query.search, mode: "insensitive" } },
      { industry: { contains: query.search, mode: "insensitive" } },
      { owner: { OR: [
        { fullName: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
      ] } },
    ] } : {}),
    ...(query.plan || query.subscriptionStatus ? { subscription: { is: {
      ...(query.plan ? { plan: query.plan } : {}),
      ...(query.subscriptionStatus ? { status: query.subscriptionStatus } : {}),
      } } } : {}),
    ...(query.platformStatus ? { platformStatus: query.platformStatus } : {}),
  };
  const orderBy: Prisma.BusinessOrderByWithRelationInput = query.sort === "name" ? { name: "asc" } : { createdAt: query.sort === "oldest" ? "asc" : "desc" };
  const [rows, total] = await Promise.all([
    prisma.business.findMany({
      where,
      orderBy,
      ...pageArgs(query.page, query.pageSize),
      select: {
        id: true, name: true, industry: true, country: true, timezone: true, onboardingCompletedAt: true, platformStatus: true, verifiedAt: true, createdAt: true,
        owner: { select: { id: true, fullName: true, email: true } },
        subscription: { select: { plan: true, status: true, currentPeriodEnd: true, trialEndsAt: true } },
        activityEvents: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        _count: { select: { members: true, customers: true, leads: true } },
      },
    }),
    prisma.business.count({ where }),
  ]);
  return pageEnvelope(rows.map(({ activityEvents, ...business }) => ({ ...business, lastActivityAt: activityEvents[0]?.createdAt ?? null })), total, query.page, query.pageSize);
}

export async function getAdminBusiness(id: string) {
  const business = await prisma.business.findUnique({
    where: { id },
    select: {
      id: true, name: true, industry: true, phone: true, country: true, timezone: true, currency: true, description: true,
      publicSlug: true, onboardingCompletedAt: true, platformStatus: true, verifiedAt: true, suspendedAt: true, suspensionReason: true, createdAt: true, updatedAt: true,
      owner: { select: { id: true, fullName: true, email: true, emailVerifiedAt: true, createdAt: true } },
      subscription: { select: { plan: true, status: true, provider: true, currentPeriodStart: true, currentPeriodEnd: true, cancelAtPeriodEnd: true, trialEndsAt: true, createdAt: true, updatedAt: true } },
      members: { orderBy: { createdAt: "asc" }, select: { id: true, role: true, status: true, createdAt: true, user: { select: { id: true, fullName: true, email: true } } } },
    },
  });
  if (!business) throw ApiError.notFound("Business not found");

  const [customers, leads, recovered, messages, reviewRequests, feedback, automationRuns, recentAutomation] = await Promise.all([
    prisma.customer.count({ where: { businessId: id } }),
    prisma.lead.count({ where: { businessId: id } }),
    prisma.lead.aggregate({ where: { businessId: id, status: "won" }, _count: { _all: true }, _sum: { estimatedValue: true } }),
    prisma.message.count({ where: { businessId: id } }),
    prisma.reviewRequest.count({ where: { businessId: id } }),
    prisma.feedback.aggregate({ where: { businessId: id }, _count: { _all: true }, _avg: { rating: true } }),
    prisma.automationRun.count({ where: { businessId: id } }),
    prisma.automationRun.findMany({
      where: { businessId: id }, orderBy: { createdAt: "desc" }, take: 8,
      select: { id: true, status: true, scheduledFor: true, startedAt: true, completedAt: true, attemptCount: true, errorMessage: true, automationRule: { select: { name: true, triggerType: true, channel: true } } },
    }),
  ]);
  return {
    business,
    stats: { customers, leads, recoveredLeads: recovered._count._all, recoveredRevenue: Number(recovered._sum.estimatedValue ?? 0), messages, reviewRequests, feedback: feedback._count._all, averageRating: feedback._avg.rating, automationRuns },
    recentAutomation: recentAutomation.map(({ errorMessage, ...run }) => ({ ...run, failureCategory: run.status === "FAILED" || run.status === "CANCELLED" ? automationFailureCategory(errorMessage) : null, executionTimeMs: executionTimeMs(run.startedAt, run.completedAt) })),
  };
}

export async function listAdminUsers(query: AdminUserListQuery) {
  const where: Prisma.UserWhereInput = {
    ...(query.search ? { OR: [
      { fullName: { contains: query.search, mode: "insensitive" } },
      { email: { contains: query.search, mode: "insensitive" } },
    ] } : {}),
    ...(query.adminOnly === undefined ? {} : query.adminOnly ? { adminMembership: { isNot: null } } : { adminMembership: { is: null } }),
  };
  const orderBy: Prisma.UserOrderByWithRelationInput = query.sort === "name" ? { fullName: "asc" } : { createdAt: query.sort === "oldest" ? "asc" : "desc" };
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where, orderBy, ...pageArgs(query.page, query.pageSize),
      select: {
        id: true, email: true, fullName: true, emailVerifiedAt: true, accountStatus: true, createdAt: true,
        adminMembership: { select: { id: true, role: true, status: true, mfaRequired: true, mfaEnrolledAt: true } },
        memberships: { select: { id: true, role: true, status: true, business: { select: { id: true, name: true } } } },
        _count: { select: { authSessions: true, deviceTokens: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return pageEnvelope(rows, total, query.page, query.pageSize);
}

export async function getAdminUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true, email: true, fullName: true, emailVerifiedAt: true, accountStatus: true, createdAt: true, updatedAt: true,
      adminMembership: { select: { id: true, role: true, status: true, mfaRequired: true, mfaEnrolledAt: true, createdAt: true } },
      authIdentities: { select: { provider: true, providerEmail: true, providerEmailVerified: true, createdAt: true } },
      memberships: { select: { id: true, role: true, status: true, createdAt: true, business: { select: { id: true, name: true } } } },
      authSessions: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, scope: true, ipAddress: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true } },
      deviceTokens: { orderBy: { lastUsedAt: "desc" }, select: { id: true, platform: true, provider: true, isActive: true, createdAt: true, lastUsedAt: true, revokedAt: true } },
    },
  });
  if (!user) throw ApiError.notFound("User not found");
  return {
    ...user,
    authSessions: user.authSessions.map(({ revokedAt, ...session }) => ({ ...session, status: revokedAt ? "revoked" : session.expiresAt <= new Date() ? "expired" : "active" })),
  };
}

export async function listAdminSubscriptions(query: AdminSubscriptionListQuery) {
  const where: Prisma.SubscriptionWhereInput = {
    ...(query.plan ? { plan: query.plan } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? { business: { OR: [
      { name: { contains: query.search, mode: "insensitive" } },
      { owner: { email: { contains: query.search, mode: "insensitive" } } },
    ] } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.subscription.findMany({
      where, orderBy: { updatedAt: "desc" }, ...pageArgs(query.page, query.pageSize),
      select: {
        id: true, plan: true, status: true, provider: true, environment: true, currentPeriodStart: true, currentPeriodEnd: true,
        cancelAtPeriodEnd: true, trialEndsAt: true, providerEventAt: true, createdAt: true, updatedAt: true,
        business: { select: { id: true, name: true, country: true, currency: true, owner: { select: { fullName: true, email: true } }, billingEvents: { orderBy: { createdAt: "desc" }, take: 5, select: { provider: true, eventType: true, processedAt: true, createdAt: true } } } },
      },
    }),
    prisma.subscription.count({ where }),
  ]);
  return pageEnvelope(rows, total, query.page, query.pageSize);
}

export async function listAdminAutomationRuns(query: AdminAutomationListQuery) {
  const where: Prisma.AutomationRunWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? { OR: [
      { business: { name: { contains: query.search, mode: "insensitive" } } },
      { automationRule: { name: { contains: query.search, mode: "insensitive" } } },
    ] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.automationRun.findMany({
      where, orderBy: { createdAt: "desc" }, ...pageArgs(query.page, query.pageSize),
      select: {
        id: true, status: true, scheduledFor: true, startedAt: true, completedAt: true, cancelledAt: true, attemptCount: true, errorMessage: true, createdAt: true,
        business: { select: { id: true, name: true } },
        automationRule: { select: { id: true, name: true, triggerType: true, channel: true, enabled: true } },
        customer: { select: { id: true, name: true } },
      },
    }),
    prisma.automationRun.count({ where }),
  ]);
  return pageEnvelope(rows.map(({ errorMessage, ...run }) => ({ ...run, failureCategory: run.status === "FAILED" || run.status === "CANCELLED" ? automationFailureCategory(errorMessage) : null, executionTimeMs: executionTimeMs(run.startedAt, run.completedAt) })), total, query.page, query.pageSize);
}

export async function getAdminCommunicationOverview() {
  const [messages, delivered, failed, templates, reviewRequests, reviewsReceived, remindersDue] = await Promise.all([
    prisma.message.count(),
    prisma.message.count({ where: { status: "delivered" } }),
    prisma.message.count({ where: { status: { in: ["failed", "undelivered"] } } }),
    prisma.messageTemplate.count(),
    prisma.reviewRequest.count(),
    prisma.reviewRequest.count({ where: { status: "reviewed" } }),
    prisma.reminder.count({ where: { status: "due", dueDate: { lte: new Date() } } }),
  ]);
  return { messages, delivered, failed, templates, reviewRequests, reviewsReceived, remindersDue };
}

export async function listAdminCommunications(query: AdminCommunicationListQuery) {
  const where: Prisma.MessageWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? { OR: [
      { body: { contains: query.search, mode: "insensitive" } },
      { business: { name: { contains: query.search, mode: "insensitive" } } },
      { customer: { name: { contains: query.search, mode: "insensitive" } } },
    ] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.message.findMany({
      where, orderBy: { createdAt: "desc" }, ...pageArgs(query.page, query.pageSize),
      select: { id: true, messageType: true, channel: true, body: true, status: true, sentAt: true, deliveredAt: true, provider: true, providerErrorCode: true, createdAt: true, business: { select: { id: true, name: true } }, customer: { select: { id: true, name: true } }, automationRun: { select: { id: true } } },
    }),
    prisma.message.count({ where }),
  ]);
  return pageEnvelope(rows.map(({ automationRun, ...message }) => ({ ...message, source: automationRun ? "automation" : "manual" })), total, query.page, query.pageSize);
}

export async function listAdminSupportTickets(query: AdminSupportListQuery) {
  const where: Prisma.SupportTicketWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? { OR: [
      { subject: { contains: query.search, mode: "insensitive" } },
      { message: { contains: query.search, mode: "insensitive" } },
      { business: { name: { contains: query.search, mode: "insensitive" } } },
      { createdByUser: { email: { contains: query.search, mode: "insensitive" } } },
    ] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.supportTicket.findMany({
      where, orderBy: { createdAt: "desc" }, ...pageArgs(query.page, query.pageSize),
      select: { id: true, category: true, subject: true, message: true, status: true, expectedResponseAt: true, resolvedAt: true, createdAt: true, updatedAt: true, business: { select: { id: true, name: true } }, createdByUser: { select: { id: true, fullName: true, email: true } } },
    }),
    prisma.supportTicket.count({ where }),
  ]);
  return pageEnvelope(rows, total, query.page, query.pageSize);
}

export async function listAdminFeedback(query: AdminFeedbackListQuery) {
  const where: Prisma.BetaFeedbackWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.rating ? { rating: query.rating } : {}),
    ...(query.search ? { OR: [{ title: { contains: query.search, mode: "insensitive" } }, { description: { contains: query.search, mode: "insensitive" } }, { business: { name: { contains: query.search, mode: "insensitive" } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.betaFeedback.findMany({ where, orderBy: { createdAt: "desc" }, ...pageArgs(query.page, query.pageSize), include: { business: { select: { id: true, name: true, industry: true } }, createdByUser: { select: { fullName: true, email: true } } } }),
    prisma.betaFeedback.count({ where }),
  ]);
  return pageEnvelope(rows, total, query.page, query.pageSize);
}

export async function getAdminSupportContext(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true, name: true, platformStatus: true, verifiedAt: true, onboardingCompletedAt: true, createdAt: true,
      owner: { select: { id: true, fullName: true, email: true, emailVerifiedAt: true, accountStatus: true, createdAt: true } },
      members: { select: { id: true, role: true, status: true, createdAt: true, user: { select: { id: true, fullName: true, email: true, accountStatus: true, authSessions: { orderBy: { createdAt: "desc" }, take: 5, select: { scope: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true, ipAddress: true, userAgent: true } } } } } },
      supportTickets: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, subject: true, category: true, status: true, createdAt: true, updatedAt: true, resolvedAt: true } },
      activityEvents: { orderBy: { createdAt: "desc" }, take: 30, select: { id: true, eventType: true, entityType: true, entityId: true, createdAt: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, messageType: true, channel: true, status: true, sentAt: true, deliveredAt: true, providerErrorCode: true, createdAt: true } },
    },
  });
  if (!business) throw ApiError.notFound("Business not found");
  return business;
}

export async function listAdminAuditLogs(query: AdminAuditListQuery) {
  const where: Prisma.AdminAuditLogWhereInput = {
    ...(query.action ? { action: query.action } : {}),
    ...(query.targetType ? { targetType: query.targetType } : {}),
    ...(query.search ? { OR: [
      { adminEmail: { contains: query.search, mode: "insensitive" } },
      { action: { contains: query.search, mode: "insensitive" } },
      { targetType: { contains: query.search, mode: "insensitive" } },
      { targetId: { contains: query.search, mode: "insensitive" } },
    ] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.adminAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, ...pageArgs(query.page, query.pageSize) }),
    prisma.adminAuditLog.count({ where }),
  ]);
  return pageEnvelope(rows, total, query.page, query.pageSize);
}
