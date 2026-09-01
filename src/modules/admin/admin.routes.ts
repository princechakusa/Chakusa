import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../../lib/config.js";
import { ApiError } from "../../lib/errors.js";
import { adminAccessGrantSchema, adminAccessUpdateSchema, adminAutomationRetrySchema, adminBusinessCohortSchema, adminBusinessConfirmationSchema, adminBusinessDeletionSchema, adminBusinessSuspensionSchema, adminCsrfHeaderSchema, adminFeedbackUpdateSchema, adminLoginSchema, adminRevokeSessionSchema, adminSessionParamsSchema, adminSettingUpdateSchema, adminUserConfirmationSchema, adminUserStatusSchema } from "./admin.schemas.js";
import { deleteBusiness, grantAdminAccess, listAdminPlatformSettings, reactivateBusiness, resetBusinessOnboarding, retryAutomationRun, revokeAdminAccess, revokeUserSessions, suspendBusiness, updateAdminAccess, updateAdminPlatformSetting, updateUserAccountStatus, updateBetaFeedback, updateBusinessCohort, verifyBusiness } from "./adminActions.service.js";
import {
  adminAuditListQuerySchema,
  adminAnalyticsQuerySchema,
  adminAutomationListQuerySchema,
  adminBusinessListQuerySchema,
  adminCommunicationListQuerySchema,
  adminDashboardQuerySchema,
  adminFeedbackListQuerySchema,
  adminIdParamsSchema,
  adminSubscriptionListQuerySchema,
  adminSupportListQuerySchema,
  adminUserListQuerySchema,
} from "./adminRead.schemas.js";
import {
  getAdminBusiness,
  getAdminAnalytics,
  getAdminBetaAnalytics,
  getAdminCommunicationOverview,
  getAdminDashboard,
  getAdminUser,
  listAdminFeedback,
  getAdminSupportContext,
  listAdminAuditLogs,
  listAdminAutomationRuns,
  listAdminBusinesses,
  listAdminCommunications,
  listAdminSubscriptions,
  listAdminSupportTickets,
  listAdminUsers,
} from "./adminRead.service.js";
import { recordAdminAudit } from "./adminAudit.service.js";
import { getAutomationFoundationStatus } from "../automation/automationFoundation.js";
import { getOutboxStatus } from "./outboxRead.service.js";
import { getPlatformWorkflow, listPlatformWorkflowExecutions, listPlatformWorkflows, retryPlatformWorkflowExecution } from "./workflowAdmin.service.js";
import { createWorkflowVersion, publishWorkflow, setWorkflowStatus } from "../automation/workflow.service.js";
import { createWorkflowTemplateVersion, listAllWorkflowTemplates, setWorkflowTemplateActive } from "../automation/workflowTemplates.js";
import { workflowDefinitionSchema } from "../automation/automation.schemas.js";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import {
  adminCustomerAnalytics,
  getAdminCustomer,
  listAdminCustomers,
  setAdminCustomerStatus,
  verifyAdminCustomer,
} from "./customerAdmin.service.js";
import {
  adminCreatePromotion,
  adminDeleteCategory,
  adminDeletePromotion,
  adminGetListing,
  adminListCategories,
  adminListListings,
  adminListPromotions,
  adminListReports,
  adminMarketplaceAnalytics,
  adminRefreshCategoryCounts,
  adminResolveReport,
  adminSeedCategories,
  adminUpdateListing,
  adminUpdatePromotion,
  adminUpsertCategory,
} from "./marketplaceAdmin.service.js";
import {
  adminBookingAnalytics,
  adminGetBooking,
  adminListBookings,
  adminRescheduleBooking,
  adminSetBookingStatus,
} from "./bookingAdmin.service.js";
import {
  adminLoyaltyAnalytics,
  adminLoyaltyCampaigns,
  adminLoyaltyFraudReview,
  adminLoyaltyMemberships,
  adminLoyaltyPrograms,
  adminLoyaltyRedemptions,
  adminLoyaltyReferrals,
  adminLoyaltyRewards,
  adminRevokeLoyaltyTransaction,
  adminRevokeRedemption,
} from "./loyaltyAdmin.service.js";
import {
  archiveLegalVersion,
  createLegalDraft,
  forceReacceptance,
  getLegalAcceptanceStats,
  listLegalVersions,
  publishLegalVersion,
  rollbackLegalVersion,
  searchLegalAcceptance,
} from "./legalAdmin.service.js";
import { LEGAL_DOCUMENT_TYPES } from "../../lib/legal/legalDocuments.service.js";
import {
  adminAIAnalytics,
  adminAICostDashboard,
  adminAIEvaluationRun,
  adminAIEvaluations,
  adminAIHealth,
  adminAIInvocations,
  adminAIMemoryMonitoring,
  adminAIModels,
  adminAIPolicyMonitoring,
  adminAIPromptPackages,
  adminAIPromptVersions,
  adminAIProviders,
  adminAIRoutingRules,
  adminSetAIModelStatus,
  adminUpsertAIModel,
} from "./aiAdmin.service.js";
import {
  adminCustomerAIAnalytics,
  adminCustomerAIConversationDetail,
  adminCustomerAIConversations,
  adminCustomerAIFeedback,
  adminCustomerAIQualityMetrics,
  adminCustomerAISettingsOverview,
  adminCustomerAIToolUsage,
  adminCustomerAIUsage,
} from "./aiCustomerAdmin.service.js";
import {
  authenticateAdminUser,
  listOwnAdminSessions,
  logoutAdminSession,
  revokeAllAdminSessions,
  revokeOwnAdminSession,
  rotateAdminRefreshToken,
} from "./adminAuth.service.js";

const REFRESH_COOKIE = "chakusa_admin_refresh";

function auditContext(request: FastifyRequest) {
  const userAgent = request.headers["user-agent"];
  return {
    ipAddress: request.ip,
    userAgent: typeof userAgent === "string" ? userAgent.slice(0, 1_000) : undefined,
    requestId: String(request.id),
  };
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return undefined;
}

function refreshCookie(value: string, maxAgeSeconds: number) {
  const secure = config.NODE_ENV === "production" ? "; Secure" : "";
  return `${REFRESH_COOKIE}=${encodeURIComponent(value)}; HttpOnly; SameSite=Strict; Path=/admin/auth; Max-Age=${maxAgeSeconds}${secure}`;
}

function clearRefreshCookie() {
  const secure = config.NODE_ENV === "production" ? "; Secure" : "";
  return `${REFRESH_COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin/auth; Max-Age=0${secure}`;
}

function requireAdminOrigin(request: FastifyRequest) {
  if (!config.ADMIN_CONSOLE_ENABLED) throw ApiError.notFound();
  const origin = request.headers.origin;
  if (config.ADMIN_CONSOLE_ORIGIN && origin !== config.ADMIN_CONSOLE_ORIGIN) {
    throw ApiError.forbidden("Admin request origin is not allowed");
  }
}

function requireCsrf(request: FastifyRequest): string {
  const value = request.headers["x-csrf-token"];
  return adminCsrfHeaderSchema.parse(Array.isArray(value) ? value[0] : value);
}

function requireRefreshCookie(request: FastifyRequest): string {
  const value = cookieValue(request.headers.cookie, REFRESH_COOKIE);
  if (!value) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Admin refresh session is missing");
  return value;
}

export default async function adminRoutes(fastify: FastifyInstance) {
  fastify.addHook("onSend", async (_request, reply) => {
    reply.header("cache-control", "no-store");
    reply.header("pragma", "no-cache");
  });

  const sessionResponse = (userId: string, sessionId: string) => ({
    accessToken: fastify.jwt.sign(
      { userId, sessionId, type: "access", scope: "admin" },
      { expiresIn: config.ACCESS_TOKEN_TTL_SECONDS },
    ),
    expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    tokenType: "Bearer" as const,
  });

  fastify.post(
    "/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      requireAdminOrigin(request);
      const result = await authenticateAdminUser(adminLoginSchema.parse(request.body), auditContext(request));
      reply.header("set-cookie", refreshCookie(result.refreshToken, config.REFRESH_TOKEN_TTL_DAYS * 86_400));
      reply.send({
        ...sessionResponse(result.user.id, result.session.id),
        csrfToken: result.csrfToken,
        user: result.user,
        admin: { id: result.membership.id, role: result.membership.role, permissions: result.permissions },
      });
    },
  );

  fastify.post(
    "/auth/refresh",
    { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      requireAdminOrigin(request);
      const result = await rotateAdminRefreshToken(requireRefreshCookie(request), requireCsrf(request), auditContext(request));
      reply.header("set-cookie", refreshCookie(result.refreshToken, config.REFRESH_TOKEN_TTL_DAYS * 86_400));
      reply.send({ ...sessionResponse(result.userId, result.session.id), csrfToken: result.csrfToken });
    },
  );

  fastify.post(
    "/auth/logout",
    { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      requireAdminOrigin(request);
      await logoutAdminSession(requireRefreshCookie(request), requireCsrf(request), auditContext(request));
      reply.header("set-cookie", clearRefreshCookie()).status(204).send();
    },
  );

  fastify.get("/auth/me", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    reply.send({
      user: { id: request.admin!.userId, email: request.admin!.email, fullName: request.admin!.fullName },
      admin: {
        id: request.admin!.membershipId,
        role: request.admin!.role,
        permissions: request.admin!.permissions,
      },
    });
  });

  fastify.get("/auth/sessions", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    const items = await listOwnAdminSessions(request.admin!.userId);
    reply.send({ items: items.map((session) => ({ ...session, current: session.id === request.admin!.sessionId })) });
  });

  fastify.delete("/auth/sessions/:id", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    await fastify.requireAdminCsrf(request);
    adminRevokeSessionSchema.parse(request.body);
    const { id } = adminSessionParamsSchema.parse(request.params);
    await revokeOwnAdminSession(request.admin!, id, auditContext(request));
    reply.status(204).send();
  });

  fastify.post("/auth/logout-all", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    await fastify.requireAdminCsrf(request);
    const { confirmation } = adminUserConfirmationSchema.parse(request.body);
    if (confirmation.toLowerCase() !== request.admin!.email.toLowerCase()) throw ApiError.badRequest("Enter your exact admin email to confirm secure logout everywhere");
    await revokeAllAdminSessions(request.admin!, auditContext(request));
    reply.header("set-cookie", clearRefreshCookie()).status(204).send();
  });

  fastify.get("/dashboard", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "platform.read");
    reply.send(await getAdminDashboard(adminDashboardQuerySchema.parse(request.query)));
  });

  fastify.get("/analytics", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "platform.read");
    reply.send(await getAdminAnalytics(adminAnalyticsQuerySchema.parse(request.query)));
  });

  fastify.get("/beta", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "platform.read");
    reply.send(await getAdminBetaAnalytics());
  });

  fastify.get("/businesses", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "business.read");
    reply.send(await listAdminBusinesses(adminBusinessListQuerySchema.parse(request.query)));
  });

  fastify.get("/businesses/:id", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "business.read");
    reply.send(await getAdminBusiness(adminIdParamsSchema.parse(request.params).id));
  });

  fastify.post("/businesses/:id/reset-onboarding", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "business.onboarding.reset");
    await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params);
    const { confirmation } = adminBusinessConfirmationSchema.parse(request.body);
    reply.send(await resetBusinessOnboarding(request.admin!, id, confirmation, auditContext(request)));
  });

  fastify.patch("/businesses/:id/cohort", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "business.cohort.manage");
    await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params);
    const { cohort } = adminBusinessCohortSchema.parse(request.body);
    reply.send(await updateBusinessCohort(request.admin!, id, cohort, auditContext(request)));
  });

  fastify.post("/businesses/:id/verify", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "business.verify"); await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params); const { confirmation } = adminBusinessConfirmationSchema.parse(request.body);
    reply.send(await verifyBusiness(request.admin!, id, confirmation, auditContext(request)));
  });

  fastify.post("/businesses/:id/suspend", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "business.suspend"); await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params); const { confirmation, reason } = adminBusinessSuspensionSchema.parse(request.body);
    reply.send(await suspendBusiness(request.admin!, id, confirmation, reason, auditContext(request)));
  });

  fastify.post("/businesses/:id/reactivate", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "business.suspend"); await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params); const { confirmation } = adminBusinessConfirmationSchema.parse(request.body);
    reply.send(await reactivateBusiness(request.admin!, id, confirmation, auditContext(request)));
  });

  fastify.delete("/businesses/:id", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "business.delete"); await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params); const { confirmation, reason } = adminBusinessDeletionSchema.parse(request.body);
    reply.send(await deleteBusiness(request.admin!, id, confirmation, reason, auditContext(request)));
  });

  fastify.get("/users", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "user.read");
    reply.send(await listAdminUsers(adminUserListQuerySchema.parse(request.query)));
  });

  fastify.get("/users/:id", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "user.read");
    reply.send(await getAdminUser(adminIdParamsSchema.parse(request.params).id));
  });

  fastify.post("/users/:id/revoke-sessions", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "user.session.revoke");
    await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params);
    const { confirmation } = adminUserConfirmationSchema.parse(request.body);
    reply.send(await revokeUserSessions(request.admin!, id, confirmation, auditContext(request)));
  });

  fastify.patch("/users/:id/account-status", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "user.disable");
    await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params);
    const { status, confirmation } = adminUserStatusSchema.parse(request.body);
    reply.send(await updateUserAccountStatus(request.admin!, id, status, confirmation, auditContext(request)));
  });

  fastify.post("/users/:id/admin-access", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "admin.manage");
    await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params);
    const { role, confirmation } = adminAccessGrantSchema.parse(request.body);
    reply.status(201).send(await grantAdminAccess(request.admin!, id, role, confirmation, auditContext(request)));
  });

  fastify.patch("/users/:id/admin-access", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "admin.manage");
    await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params);
    const input = adminAccessUpdateSchema.parse(request.body);
    reply.send(await updateAdminAccess(request.admin!, id, input, auditContext(request)));
  });

  fastify.delete("/users/:id/admin-access", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "admin.manage");
    await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params);
    const { confirmation } = adminUserConfirmationSchema.parse(request.body);
    reply.send(await revokeAdminAccess(request.admin!, id, confirmation, auditContext(request)));
  });

  fastify.get("/subscriptions", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "subscription.read");
    reply.send(await listAdminSubscriptions(adminSubscriptionListQuerySchema.parse(request.query)));
  });

  fastify.get("/automation/runs", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "automation.read");
    reply.send(await listAdminAutomationRuns(adminAutomationListQuerySchema.parse(request.query)));
  });

  fastify.post("/automation/runs/:id/retry", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "automation.retry");
    await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params);
    adminAutomationRetrySchema.parse(request.body);
    reply.send(await retryAutomationRun(request.admin!, id, auditContext(request)));
  });

  fastify.get("/communications/overview", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "communication.read");
    reply.send(await getAdminCommunicationOverview());
  });

  fastify.get("/communications", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "communication.read");
    reply.send(await listAdminCommunications(adminCommunicationListQuerySchema.parse(request.query)));
  });

  fastify.get("/communications/operations", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "communication.read");
    const [providers, credentials, templates, slas, attachments, conversations, scans, syncAttempts] = await Promise.all([
      prisma.messagingChannelAccount.findMany({ where: { deletedAt: null }, select: { id: true, businessId: true, provider: true, channel: true, status: true, healthStatus: true, lastHealthAt: true } }),
      prisma.providerCredential.findMany({ where: { deletedAt: null }, select: { id: true, businessId: true, channelAccountId: true, keyVersion: true, status: true, validationStatus: true, lastValidatedAt: true, expiresAt: true } }),
      prisma.messagingTemplate.findMany({ where: { deletedAt: null }, include: { versions: { orderBy: { version: "desc" }, take: 5 } } }),
      prisma.conversationSLA.groupBy({ by: ["type", "status"], _count: true }),
      prisma.messageAttachment.groupBy({ by: ["uploadStatus", "malwareScanStatus"], _count: true }),
      prisma.conversation.groupBy({ by: ["status", "priority"], where: { deletedAt: null }, _count: true }),
      prisma.attachmentProcessingEvent.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, businessId: true, attachmentId: true, type: true, status: true, detail: true, createdAt: true } }),
      prisma.templateSyncAttempt.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, businessId: true, providerTemplateId: true, status: true, detail: true, createdAt: true } }),
    ]);
    reply.send({ providers, credentials, templates, slas, attachments, conversations, scans, syncAttempts });
  });

  fastify.get("/support", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "support.read");
    reply.send(await listAdminSupportTickets(adminSupportListQuerySchema.parse(request.query)));
  });

  fastify.get("/feedback", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "feedback.read");
    reply.send(await listAdminFeedback(adminFeedbackListQuerySchema.parse(request.query)));
  });

  fastify.patch("/feedback/:id", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "feedback.manage");
    await fastify.requireAdminCsrf(request);
    const { id } = adminIdParamsSchema.parse(request.params);
    const input = adminFeedbackUpdateSchema.parse(request.body);
    reply.send(await updateBetaFeedback(request.admin!, id, input.status, input.internalNotes ?? null, auditContext(request)));
  });

  fastify.get("/support/businesses/:id/context", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "support.impersonate.read");
    const { id } = adminIdParamsSchema.parse(request.params);
    const context = await getAdminSupportContext(id);
    await recordAdminAudit({ actor: request.admin!, action: "SUPPORT_READ_ONLY_CONTEXT_VIEWED", targetType: "business", targetId: id, newValue: { mode: "read_only", memberCount: context.members.length, ticketCount: context.supportTickets.length }, context: auditContext(request) });
    reply.send(context);
  });

  fastify.get("/audit", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "audit.read");
    reply.send(await listAdminAuditLogs(adminAuditListQuerySchema.parse(request.query)));
  });

  fastify.get("/settings", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "settings.read");
    reply.send({ items: await listAdminPlatformSettings() });
  });

  fastify.get("/automation/foundation", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "automation.read");
    reply.send(await getAutomationFoundationStatus());
  });

  fastify.get("/outbox", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "automation.read");
    reply.send(await getOutboxStatus());
  });
  fastify.get("/workflows", { preHandler: fastify.authenticateAdmin }, async (request, reply) => { fastify.requireAdminPermission(request, "workflow.view"); reply.send({ items: await listPlatformWorkflows() }); });
  fastify.get<{ Params: { id: string } }>("/workflows/:id", { preHandler: fastify.authenticateAdmin }, async (request, reply) => { fastify.requireAdminPermission(request, "workflow.view"); const workflow = await getPlatformWorkflow(request.params.id); if (!workflow) throw ApiError.notFound("Workflow not found"); reply.send(workflow); });
  fastify.post<{ Params: { id: string } }>("/workflows/:id/versions", { preHandler: fastify.authenticateAdmin }, async (request, reply) => { fastify.requireAdminPermission(request, "workflow.edit"); await fastify.requireAdminCsrf(request); const workflow = await getPlatformWorkflow(request.params.id); if (!workflow) throw ApiError.notFound("Workflow not found"); const input = z.object({ definition: workflowDefinitionSchema }).parse(request.body); const created = await createWorkflowVersion(workflow.businessId, workflow.id, input.definition); await recordAdminAudit({ actor: request.admin!, action: "WORKFLOW_VERSION_CREATED", targetType: "workflow", targetId: workflow.id, newValue: { version: created.version }, context: auditContext(request) }); reply.code(201).send(created); });
  fastify.get("/workflow-templates", { preHandler: fastify.authenticateAdmin }, async (request, reply) => { fastify.requireAdminPermission(request, "workflow.view"); reply.send({ items: await listAllWorkflowTemplates() }); });
  fastify.post("/workflow-templates", { preHandler: fastify.authenticateAdmin }, async (request, reply) => { fastify.requireAdminPermission(request, "workflow.edit"); await fastify.requireAdminCsrf(request); const input = z.object({ key: z.string().trim().regex(/^[A-Z0-9_]{2,80}$/), name: z.string().trim().min(1).max(120), description: z.string().trim().max(1000).optional(), definition: workflowDefinitionSchema }).parse(request.body); const created = await createWorkflowTemplateVersion(input); await recordAdminAudit({ actor: request.admin!, action: "WORKFLOW_TEMPLATE_VERSION_CREATED", targetType: "workflow_template", targetId: created.id, newValue: { key: created.key, version: created.version }, context: auditContext(request) }); reply.code(201).send(created); });
  fastify.post<{ Params: { id: string; action: string } }>("/workflow-templates/:id/:action", { preHandler: fastify.authenticateAdmin }, async (request, reply) => { fastify.requireAdminPermission(request, "workflow.edit"); await fastify.requireAdminCsrf(request); if (!["activate", "deactivate"].includes(request.params.action)) throw ApiError.badRequest("Unsupported template action"); const updated = await setWorkflowTemplateActive(request.params.id, request.params.action === "activate"); await recordAdminAudit({ actor: request.admin!, action: `WORKFLOW_TEMPLATE_${request.params.action.toUpperCase()}`, targetType: "workflow_template", targetId: updated.id, newValue: { active: updated.active }, context: auditContext(request) }); reply.send(updated); });
  fastify.post<{ Params: { id: string; action: string } }>("/workflows/:id/:action", { preHandler: fastify.authenticateAdmin }, async (request, reply) => { const action = request.params.action; if (!(["publish", "pause", "resume"] as const).includes(action as "publish" | "pause" | "resume")) throw ApiError.badRequest("Unsupported workflow action"); const permission = action === "publish" ? "workflow.publish" : action === "pause" ? "workflow.pause" : "workflow.resume"; fastify.requireAdminPermission(request, permission); await fastify.requireAdminCsrf(request); const workflow = await getPlatformWorkflow(request.params.id); if (!workflow) throw ApiError.notFound("Workflow not found"); const updated = action === "publish" ? await publishWorkflow(workflow.businessId, workflow.id) : await setWorkflowStatus(workflow.businessId, workflow.id, action === "pause" ? "PAUSED" : "PUBLISHED"); await recordAdminAudit({ actor: request.admin!, action: `WORKFLOW_${action.toUpperCase()}`, targetType: "workflow", targetId: workflow.id, oldValue: { status: workflow.status }, newValue: { status: updated.status }, context: auditContext(request) }); reply.send(updated); });
  fastify.get("/workflow-executions", { preHandler: fastify.authenticateAdmin }, async (request, reply) => { fastify.requireAdminPermission(request, "workflow.view"); const status = (request.query as { status?: string }).status; reply.send({ items: await listPlatformWorkflowExecutions(status) }); });
  fastify.post<{ Params: { id: string } }>("/workflow-executions/:id/retry", { preHandler: fastify.authenticateAdmin }, async (request, reply) => { fastify.requireAdminPermission(request, "automation.retry"); await fastify.requireAdminCsrf(request); const result = await retryPlatformWorkflowExecution(request.params.id); if (!result.count) throw ApiError.conflict("Only failed or cancelled workflow executions can be retried"); await recordAdminAudit({ actor: request.admin!, action: "WORKFLOW_EXECUTION_RETRIED", targetType: "workflow_execution", targetId: request.params.id, newValue: { status: "PENDING" }, context: auditContext(request) }); reply.send({ id: request.params.id, status: "PENDING" }); });

  fastify.patch("/settings", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "settings.manage");
    await fastify.requireAdminCsrf(request);
    const input = adminSettingUpdateSchema.parse(request.body);
    reply.send(await updateAdminPlatformSetting(request.admin!, input.key, input.enabled, auditContext(request)));
  });

  // LOOP 3B-4: AI administration. Read views require `platform.read`; the
  // model registry (the one mutable surface) requires `ai.manage`.
  const aiRead = { preHandler: fastify.authenticateAdmin } as const;
  fastify.get("/ai/providers", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send(await adminAIProviders()); });
  fastify.get("/ai/models", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send({ items: await adminAIModels() }); });
  fastify.post("/ai/models", aiRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "ai.manage");
    await fastify.requireAdminCsrf(request);
    const input = z.object({ provider: z.string().trim().min(1).max(60), model: z.string().trim().min(1).max(120), version: z.string().trim().min(1).max(40), capabilities: z.array(z.string().trim().max(60)).min(1), approvedUseCases: z.array(z.string().trim().max(60)).min(1), pricing: z.unknown().optional(), supportedLanguages: z.unknown().optional(), status: z.enum(["ACTIVE", "DISABLED", "DEPRECATED"]).optional() }).parse(request.body);
    const saved = await adminUpsertAIModel(input);
    await recordAdminAudit({ actor: request.admin!, action: "AI_MODEL_UPSERTED", targetType: "ai_model", targetId: saved.id, newValue: { provider: saved.provider, model: saved.model, version: saved.version, status: saved.status }, context: auditContext(request) });
    reply.code(201).send(saved);
  });
  fastify.patch<{ Params: { id: string } }>("/ai/models/:id/status", aiRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "ai.manage");
    await fastify.requireAdminCsrf(request);
    const input = z.object({ status: z.enum(["ACTIVE", "DISABLED", "DEPRECATED"]), healthStatus: z.enum(["HEALTHY", "DEGRADED", "DOWN", "UNKNOWN"]).optional() }).parse(request.body);
    const updated = await adminSetAIModelStatus(request.params.id, input.status, input.healthStatus);
    await recordAdminAudit({ actor: request.admin!, action: "AI_MODEL_STATUS_CHANGED", targetType: "ai_model", targetId: updated.id, newValue: { status: updated.status, healthStatus: updated.healthStatus }, context: auditContext(request) });
    reply.send(updated);
  });
  fastify.get("/ai/routing", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send(await adminAIRoutingRules()); });
  fastify.get("/ai/prompt-packages", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send({ items: await adminAIPromptPackages() }); });
  fastify.get<{ Querystring: { templateId?: string } }>("/ai/prompt-versions", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); const templateId = z.object({ templateId: z.string().uuid() }).parse(request.query).templateId; reply.send(await adminAIPromptVersions(templateId)); });
  fastify.get("/ai/evaluations", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send({ items: await adminAIEvaluations() }); });
  fastify.get<{ Params: { id: string } }>("/ai/evaluations/:id", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send(await adminAIEvaluationRun(request.params.id)); });
  fastify.get("/ai/invocations", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); const query = z.object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional(), businessId: z.string().uuid().optional(), provider: z.string().optional(), outcome: z.string().optional() }).parse(request.query); reply.send(await adminAIInvocations(query)); });
  fastify.get("/ai/analytics", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send(await adminAIAnalytics()); });
  fastify.get("/ai/health", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send(await adminAIHealth()); });
  fastify.get("/ai/cost", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); const sinceHours = z.object({ sinceHours: z.coerce.number().int().min(1).max(8760).default(720) }).parse(request.query).sinceHours; reply.send(await adminAICostDashboard(sinceHours)); });
  fastify.get("/ai/memory-monitoring", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send(await adminAIMemoryMonitoring()); });
  fastify.get("/ai/policy-monitoring", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send(await adminAIPolicyMonitoring()); });

  // PROGRAM 2 LOOP 4: Customer AI Assistant oversight. Read-only, same
  // `platform.read` gate + `aiRead` preHandler as every other /ai/* route.
  fastify.get("/ai/customer/analytics", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send(await adminCustomerAIAnalytics()); });
  fastify.get("/ai/customer/usage", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); const days = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }).parse(request.query).days; reply.send(await adminCustomerAIUsage(days)); });
  fastify.get("/ai/customer/tool-usage", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send(await adminCustomerAIToolUsage()); });
  fastify.get("/ai/customer/conversations", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); const query = z.object({ customerProfileId: z.string().uuid().optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional() }).parse(request.query); reply.send(await adminCustomerAIConversations(query)); });
  fastify.get<{ Params: { id: string } }>("/ai/customer/conversations/:id", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send(await adminCustomerAIConversationDetail(request.params.id)); });
  fastify.get("/ai/customer/feedback", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); const query = z.object({ page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional() }).parse(request.query); reply.send(await adminCustomerAIFeedback(query)); });
  fastify.get("/ai/customer/quality", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send(await adminCustomerAIQualityMetrics()); });
  fastify.get("/ai/customer/settings-overview", aiRead, async (request, reply) => { fastify.requireAdminPermission(request, "platform.read"); reply.send(await adminCustomerAISettingsOverview()); });

  // PROGRAM 2 LOOP 1: Customer Platform administration. Reads require
  // `customer.read`; status / verify require `customer.manage` + CSRF + audit.
  fastify.get("/customers", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "customer.read");
    const query = z.object({ search: z.string().trim().max(120).optional(), status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]).optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query);
    reply.send(await listAdminCustomers(query));
  });
  fastify.get("/customers/analytics", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "customer.read");
    reply.send(await adminCustomerAnalytics());
  });
  fastify.get<{ Params: { id: string } }>("/customers/:id", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "customer.read");
    reply.send(await getAdminCustomer(request.params.id));
  });
  fastify.patch<{ Params: { id: string } }>("/customers/:id/status", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "customer.manage");
    await fastify.requireAdminCsrf(request);
    const input = z.object({ status: z.enum(["ACTIVE", "SUSPENDED", "DELETED"]), reason: z.string().trim().max(500).optional() }).parse(request.body);
    const result = await setAdminCustomerStatus(request.params.id, input.status, input.reason);
    await recordAdminAudit({ actor: request.admin!, action: "CUSTOMER_STATUS_CHANGED", targetType: "customer_profile", targetId: request.params.id, oldValue: { status: result.previousStatus }, newValue: { status: input.status }, context: auditContext(request) });
    reply.send(result);
  });
  fastify.post<{ Params: { id: string } }>("/customers/:id/verify", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "customer.manage");
    await fastify.requireAdminCsrf(request);
    const updated = await verifyAdminCustomer(request.params.id);
    await recordAdminAudit({ actor: request.admin!, action: "CUSTOMER_VERIFIED", targetType: "customer_profile", targetId: request.params.id, newValue: { verifiedAt: updated.verifiedAt }, context: auditContext(request) });
    reply.send(updated);
  });

  // PROGRAM 2 LOOP 2: Marketplace administration. Reads need `marketplace.read`;
  // curation needs `marketplace.manage` + CSRF + audit.
  const mktRead = { preHandler: fastify.authenticateAdmin } as const;
  fastify.get("/marketplace/listings", mktRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "marketplace.read");
    const q = z.object({ search: z.string().trim().max(120).optional(), featured: z.coerce.boolean().optional(), page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query);
    reply.send(await adminListListings(q));
  });
  fastify.get("/marketplace/analytics", mktRead, async (request, reply) => { fastify.requireAdminPermission(request, "marketplace.read"); reply.send(await adminMarketplaceAnalytics()); });
  fastify.get<{ Params: { businessId: string } }>("/marketplace/listings/:businessId", mktRead, async (request, reply) => { fastify.requireAdminPermission(request, "marketplace.read"); reply.send(await adminGetListing(request.params.businessId)); });
  fastify.patch<{ Params: { businessId: string } }>("/marketplace/listings/:businessId", mktRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "marketplace.manage");
    await fastify.requireAdminCsrf(request);
    const patch = z.object({
      listed: z.boolean().optional(), discoverable: z.boolean().optional(), featured: z.boolean().optional(),
      featuredRank: z.number().int().nullable().optional(), featuredUntil: z.string().datetime().nullable().optional(),
      categorySlug: z.string().trim().max(80).nullable().optional(), subcategorySlug: z.string().trim().max(80).nullable().optional(),
      shortTagline: z.string().trim().max(200).nullable().optional(), photos: z.array(z.string().url().max(2048)).max(20).nullable().optional(),
      socialLinks: z.record(z.string(), z.string().url().max(2048)).nullable().optional(),
      addressLine: z.string().trim().max(300).nullable().optional(), city: z.string().trim().max(120).nullable().optional(), region: z.string().trim().max(120).nullable().optional(),
      latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(),
    }).parse(request.body);
    const updated = await adminUpdateListing(request.params.businessId, patch);
    await recordAdminAudit({ actor: request.admin!, action: "MARKETPLACE_LISTING_UPDATED", targetType: "business", targetId: request.params.businessId, newValue: { featured: updated.featured, listed: updated.listed, categorySlug: updated.categorySlug }, context: auditContext(request) });
    reply.send(updated);
  });

  fastify.get("/marketplace/categories", mktRead, async (request, reply) => { fastify.requireAdminPermission(request, "marketplace.read"); reply.send({ items: await adminListCategories() }); });
  fastify.post("/marketplace/categories", mktRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "marketplace.manage");
    await fastify.requireAdminCsrf(request);
    const input = z.object({ slug: z.string().trim().min(1).max(80).regex(/^[a-z0-9-]+$/), name: z.string().trim().min(1).max(120), icon: z.string().trim().max(60).optional(), description: z.string().trim().max(500).optional(), parentSlug: z.string().trim().max(80).nullable().optional(), sortOrder: z.number().int().optional(), trending: z.boolean().optional(), active: z.boolean().optional() }).parse(request.body);
    const category = await adminUpsertCategory(input);
    await recordAdminAudit({ actor: request.admin!, action: "MARKETPLACE_CATEGORY_UPSERTED", targetType: "marketplace_category", targetId: category.id, newValue: { slug: category.slug, name: category.name }, context: auditContext(request) });
    reply.code(201).send(category);
  });
  fastify.post("/marketplace/categories/seed", mktRead, async (request, reply) => { fastify.requireAdminPermission(request, "marketplace.manage"); await fastify.requireAdminCsrf(request); reply.send(await adminSeedCategories()); });
  fastify.post("/marketplace/categories/refresh-counts", mktRead, async (request, reply) => { fastify.requireAdminPermission(request, "marketplace.manage"); await fastify.requireAdminCsrf(request); reply.send(await adminRefreshCategoryCounts()); });
  fastify.delete<{ Params: { slug: string } }>("/marketplace/categories/:slug", mktRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "marketplace.manage");
    await fastify.requireAdminCsrf(request);
    reply.send(await adminDeleteCategory(request.params.slug));
  });

  fastify.get("/marketplace/promotions", mktRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "marketplace.read");
    const q = z.object({ businessId: z.string().uuid().optional(), activeOnly: z.coerce.boolean().optional() }).parse(request.query);
    reply.send({ items: await adminListPromotions(q) });
  });
  fastify.post("/marketplace/promotions", mktRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "marketplace.manage");
    await fastify.requireAdminCsrf(request);
    const input = z.object({ businessId: z.string().uuid(), title: z.string().trim().min(1).max(160), description: z.string().trim().max(2000).optional(), badge: z.string().trim().max(40).optional(), startsAt: z.string().datetime().optional(), endsAt: z.string().datetime().optional() }).parse(request.body);
    const promotion = await adminCreatePromotion({ ...input, createdByUserId: request.admin!.userId });
    await recordAdminAudit({ actor: request.admin!, action: "MARKETPLACE_PROMOTION_CREATED", targetType: "marketplace_promotion", targetId: promotion.id, newValue: { businessId: input.businessId, title: input.title }, context: auditContext(request) });
    reply.code(201).send(promotion);
  });
  fastify.patch<{ Params: { id: string } }>("/marketplace/promotions/:id", mktRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "marketplace.manage");
    await fastify.requireAdminCsrf(request);
    const patch = z.object({ title: z.string().trim().min(1).max(160).optional(), description: z.string().trim().max(2000).nullable().optional(), badge: z.string().trim().max(40).nullable().optional(), endsAt: z.string().datetime().nullable().optional(), active: z.boolean().optional() }).parse(request.body);
    reply.send(await adminUpdatePromotion(request.params.id, patch));
  });
  fastify.delete<{ Params: { id: string } }>("/marketplace/promotions/:id", mktRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "marketplace.manage");
    await fastify.requireAdminCsrf(request);
    await adminDeletePromotion(request.params.id);
    reply.code(204).send();
  });

  fastify.get("/marketplace/reports", mktRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "marketplace.read");
    const q = z.object({ status: z.enum(["OPEN", "REVIEWING", "RESOLVED", "DISMISSED"]).optional() }).parse(request.query);
    reply.send({ items: await adminListReports(q) });
  });
  fastify.patch<{ Params: { id: string } }>("/marketplace/reports/:id", mktRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "marketplace.manage");
    await fastify.requireAdminCsrf(request);
    const input = z.object({ status: z.enum(["REVIEWING", "RESOLVED", "DISMISSED"]) }).parse(request.body);
    const updated = await adminResolveReport(request.params.id, input.status, request.admin!.userId);
    await recordAdminAudit({ actor: request.admin!, action: "MARKETPLACE_REPORT_RESOLVED", targetType: "business_report", targetId: request.params.id, newValue: { status: input.status }, context: auditContext(request) });
    reply.send(updated);
  });

  // PROGRAM 2 LOOP 3: booking oversight. Reads need `booking.read`; manual
  // adjustments need `booking.manage` + CSRF + audit and delegate to the
  // existing appointment services.
  const bookingRead = { preHandler: fastify.authenticateAdmin } as const;
  const bookingStatusEnum = z.enum(["SCHEDULED", "CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"]);
  fastify.get("/bookings", bookingRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "booking.read");
    const q = z.object({
      businessId: z.string().uuid().optional(),
      status: bookingStatusEnum.optional(),
      customerProfileId: z.string().uuid().optional(),
      channel: z.enum(["business", "public", "customer_app"]).optional(),
      from: z.string().datetime({ offset: true }).optional(),
      to: z.string().datetime({ offset: true }).optional(),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
    }).parse(request.query);
    reply.send(await adminListBookings(q));
  });
  fastify.get("/bookings/analytics", bookingRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "booking.read");
    reply.send(await adminBookingAnalytics());
  });
  fastify.get<{ Params: { id: string } }>("/bookings/:id", bookingRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "booking.read");
    reply.send(await adminGetBooking(request.params.id));
  });
  fastify.patch<{ Params: { id: string } }>("/bookings/:id/reschedule", bookingRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "booking.manage");
    await fastify.requireAdminCsrf(request);
    const input = z.object({ startsAt: z.string().datetime({ offset: true }), assignedMemberId: z.string().uuid().nullable().optional(), reason: z.string().trim().max(500).optional() }).parse(request.body);
    const updated = await adminRescheduleBooking(request.admin!.userId, request.params.id, input);
    await recordAdminAudit({ actor: request.admin!, action: "BOOKING_RESCHEDULED", targetType: "appointment", targetId: request.params.id, newValue: { startsAt: input.startsAt, reason: input.reason ?? null }, context: auditContext(request) });
    reply.send(updated);
  });
  fastify.post<{ Params: { id: string } }>("/bookings/:id/status", bookingRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "booking.manage");
    await fastify.requireAdminCsrf(request);
    const input = z.object({ status: z.enum(["CONFIRMED", "COMPLETED", "CANCELED", "NO_SHOW"]), reason: z.string().trim().max(500).optional() }).parse(request.body);
    const updated = await adminSetBookingStatus(request.admin!.userId, request.params.id, input.status);
    await recordAdminAudit({ actor: request.admin!, action: "BOOKING_STATUS_CHANGED", targetType: "appointment", targetId: request.params.id, newValue: { status: input.status, reason: input.reason ?? null }, context: auditContext(request) });
    reply.send(updated);
  });

  // PROGRAM 2 LOOP 5: platform loyalty oversight. Reads need `loyalty.read`;
  // reversals need `loyalty.manage` + CSRF + audit.
  const loyaltyRead = { preHandler: fastify.authenticateAdmin } as const;
  const paged = { page: z.coerce.number().int().min(1).optional(), pageSize: z.coerce.number().int().min(1).max(200).optional() };
  fastify.get("/loyalty/analytics", loyaltyRead, async (request, reply) => { fastify.requireAdminPermission(request, "loyalty.read"); reply.send(await adminLoyaltyAnalytics()); });
  fastify.get("/loyalty/fraud-review", loyaltyRead, async (request, reply) => { fastify.requireAdminPermission(request, "loyalty.read"); reply.send(await adminLoyaltyFraudReview()); });
  fastify.get("/loyalty/programs", loyaltyRead, async (request, reply) => { fastify.requireAdminPermission(request, "loyalty.read"); reply.send(await adminLoyaltyPrograms(z.object(paged).parse(request.query))); });
  fastify.get("/loyalty/memberships", loyaltyRead, async (request, reply) => { fastify.requireAdminPermission(request, "loyalty.read"); reply.send(await adminLoyaltyMemberships(z.object({ status: z.string().max(20).optional(), ...paged }).parse(request.query))); });
  fastify.get("/loyalty/rewards", loyaltyRead, async (request, reply) => { fastify.requireAdminPermission(request, "loyalty.read"); reply.send(await adminLoyaltyRewards(z.object(paged).parse(request.query))); });
  fastify.get("/loyalty/redemptions", loyaltyRead, async (request, reply) => { fastify.requireAdminPermission(request, "loyalty.read"); reply.send(await adminLoyaltyRedemptions(z.object({ status: z.string().max(20).optional(), ...paged }).parse(request.query))); });
  fastify.get("/loyalty/referrals", loyaltyRead, async (request, reply) => { fastify.requireAdminPermission(request, "loyalty.read"); reply.send(await adminLoyaltyReferrals(z.object({ status: z.string().max(20).optional(), ...paged }).parse(request.query))); });
  fastify.get("/loyalty/campaigns", loyaltyRead, async (request, reply) => { fastify.requireAdminPermission(request, "loyalty.read"); reply.send(await adminLoyaltyCampaigns(z.object({ activeOnly: z.coerce.boolean().optional(), ...paged }).parse(request.query))); });
  fastify.post<{ Params: { id: string } }>("/loyalty/transactions/:id/revoke", loyaltyRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "loyalty.manage");
    await fastify.requireAdminCsrf(request);
    const { reason } = z.object({ reason: z.string().trim().min(1).max(500) }).parse(request.body);
    const result = await adminRevokeLoyaltyTransaction(request.params.id, reason, request.admin!.userId);
    await recordAdminAudit({ actor: request.admin!, action: "LOYALTY_TRANSACTION_REVOKED", targetType: "loyalty_transaction", targetId: request.params.id, newValue: { reason }, context: auditContext(request) });
    reply.send(result);
  });
  fastify.post<{ Params: { id: string } }>("/loyalty/redemptions/:id/revoke", loyaltyRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "loyalty.manage");
    await fastify.requireAdminCsrf(request);
    const { reason } = z.object({ reason: z.string().trim().min(1).max(500) }).parse(request.body);
    const result = await adminRevokeRedemption(request.params.id, reason);
    await recordAdminAudit({ actor: request.admin!, action: "LOYALTY_REDEMPTION_REVOKED", targetType: "reward_redemption", targetId: request.params.id, newValue: { reason }, context: auditContext(request) });
    reply.send(result);
  });

  // PROGRAM 2 LOOP 4: legal document version management + acceptance
  // search. Reads need `legal.read`; version mutations need `legal.manage`
  // + CSRF + audit, following the same shape as the loyalty admin block
  // above.
  const legalRead = { preHandler: fastify.authenticateAdmin } as const;
  const legalDocumentTypeSchema = z.enum(LEGAL_DOCUMENT_TYPES);
  fastify.get("/legal/versions", legalRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "legal.read");
    const { type } = z.object({ type: legalDocumentTypeSchema }).parse(request.query);
    reply.send({ items: await listLegalVersions(type) });
  });
  fastify.get<{ Params: { id: string } }>("/legal/versions/:id/stats", legalRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "legal.read");
    reply.send(await getLegalAcceptanceStats(request.params.id));
  });
  fastify.get("/legal/acceptance", legalRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "legal.read");
    const query = z.object({ userId: z.string().uuid().optional(), documentVersionId: z.string().uuid().optional(), type: legalDocumentTypeSchema.optional() }).parse(request.query);
    reply.send({ items: await searchLegalAcceptance(query) });
  });
  fastify.post("/legal/versions", legalRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "legal.manage");
    await fastify.requireAdminCsrf(request);
    const input = z.object({
      type: legalDocumentTypeSchema,
      title: z.string().trim().min(1).max(200),
      content: z.string().trim().min(1),
      summary: z.string().trim().max(2000).optional(),
      effectiveAt: z.coerce.date().optional(),
      requiresReacceptance: z.boolean().optional(),
    }).parse(request.body);
    const created = await createLegalDraft(request.admin!, input, auditContext(request));
    reply.code(201).send(created);
  });
  fastify.post<{ Params: { id: string } }>("/legal/versions/:id/publish", legalRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "legal.manage");
    await fastify.requireAdminCsrf(request);
    reply.send(await publishLegalVersion(request.admin!, request.params.id, auditContext(request)));
  });
  fastify.post<{ Params: { id: string } }>("/legal/versions/:id/archive", legalRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "legal.manage");
    await fastify.requireAdminCsrf(request);
    reply.send(await archiveLegalVersion(request.admin!, request.params.id, auditContext(request)));
  });
  fastify.post<{ Params: { id: string } }>("/legal/versions/:id/rollback", legalRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "legal.manage");
    await fastify.requireAdminCsrf(request);
    reply.send(await rollbackLegalVersion(request.admin!, request.params.id, auditContext(request)));
  });
  fastify.post<{ Params: { id: string } }>("/legal/versions/:id/force-reacceptance", legalRead, async (request, reply) => {
    fastify.requireAdminPermission(request, "legal.manage");
    await fastify.requireAdminCsrf(request);
    reply.send(await forceReacceptance(request.admin!, request.params.id, auditContext(request)));
  });
}
