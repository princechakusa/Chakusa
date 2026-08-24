import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { workerHeartbeatHealthy } from "../../worker/workerHeartbeat.js";
import { ApiError } from "../../lib/errors.js";
import type {
  AdminAuditListQuery,
  AdminAutomationListQuery,
  AdminBusinessListQuery,
  AdminCommunicationListQuery,
  AdminDashboardQuery,
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
