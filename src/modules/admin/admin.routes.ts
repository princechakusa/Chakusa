import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../../lib/config.js";
import { ApiError } from "../../lib/errors.js";
import { adminAccessGrantSchema, adminAccessUpdateSchema, adminAutomationRetrySchema, adminBusinessConfirmationSchema, adminBusinessDeletionSchema, adminBusinessSuspensionSchema, adminCsrfHeaderSchema, adminLoginSchema, adminRevokeSessionSchema, adminSessionParamsSchema, adminSettingUpdateSchema, adminUserConfirmationSchema, adminUserStatusSchema } from "./admin.schemas.js";
import { deleteBusiness, grantAdminAccess, listAdminPlatformSettings, reactivateBusiness, resetBusinessOnboarding, retryAutomationRun, revokeAdminAccess, revokeUserSessions, suspendBusiness, updateAdminAccess, updateAdminPlatformSetting, updateUserAccountStatus, verifyBusiness } from "./adminActions.service.js";
import {
  adminAuditListQuerySchema,
  adminAnalyticsQuerySchema,
  adminAutomationListQuerySchema,
  adminBusinessListQuerySchema,
  adminCommunicationListQuerySchema,
  adminDashboardQuerySchema,
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

  fastify.get("/support", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "support.read");
    reply.send(await listAdminSupportTickets(adminSupportListQuerySchema.parse(request.query)));
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

  fastify.patch("/settings", { preHandler: fastify.authenticateAdmin }, async (request, reply) => {
    fastify.requireAdminPermission(request, "settings.manage");
    await fastify.requireAdminCsrf(request);
    const input = adminSettingUpdateSchema.parse(request.body);
    reply.send(await updateAdminPlatformSetting(request.admin!, input.key, input.enabled, auditContext(request)));
  });
}
