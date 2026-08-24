import fp from "fastify-plugin";
import type { AdminRole } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { config } from "../lib/config.js";
import { permissionsForAdminRole, requireAdminPermission, type AdminPermission } from "../modules/admin/admin.permissions.js";
import { adminCsrfHeaderSchema } from "../modules/admin/admin.schemas.js";
import { tokenHashMatches } from "../lib/authTokens.js";

export interface AdminPrincipal {
  membershipId: string;
  userId: string;
  email: string;
  fullName: string;
  role: AdminRole;
  permissions: readonly AdminPermission[];
  sessionId: string;
}

declare module "fastify" {
  interface FastifyRequest { admin?: AdminPrincipal }
  interface FastifyInstance {
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdminPermission: (request: FastifyRequest, permission: AdminPermission) => void;
    requireAdminCsrf: (request: FastifyRequest) => Promise<void>;
  }
}

export default fp(async function adminAuthPlugin(fastify: FastifyInstance) {
  fastify.decorate("authenticateAdmin", async function (request: FastifyRequest) {
    if (!config.ADMIN_CONSOLE_ENABLED) throw ApiError.notFound();
    try {
      await request.jwtVerify();
    } catch {
      throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid or expired admin access token");
    }
    if (request.user.type !== "access" || request.user.scope !== "admin") {
      throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid admin access token");
    }

    const membership = await prisma.adminMembership.findFirst({
      where: {
        userId: request.user.userId,
        status: "ACTIVE",
        user: {
          authSessions: {
            some: {
              id: request.user.sessionId,
              scope: "ADMIN",
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
          },
        },
      },
      include: { user: { select: { email: true, fullName: true, accountStatus: true } } },
    });
    if (!membership) throw ApiError.auth(401, "AUTH_SESSION_EXPIRED", "Admin session expired");
    if (membership.user.accountStatus === "DISABLED") throw ApiError.auth(403, "AUTH_ACCOUNT_DISABLED", "This account has been disabled");

    request.admin = {
      membershipId: membership.id,
      userId: membership.userId,
      email: membership.user.email,
      fullName: membership.user.fullName,
      role: membership.role,
      permissions: permissionsForAdminRole(membership.role),
      sessionId: request.user.sessionId,
    };
  });

  fastify.decorate("requireAdminPermission", function (request: FastifyRequest, permission: AdminPermission) {
    if (!request.admin) throw ApiError.unauthorized();
    requireAdminPermission(request.admin.role, permission);
  });

  fastify.decorate("requireAdminCsrf", async function (request: FastifyRequest) {
    if (!request.admin) throw ApiError.unauthorized();
    const value = request.headers["x-csrf-token"];
    const csrfToken = adminCsrfHeaderSchema.parse(Array.isArray(value) ? value[0] : value);
    const session = await prisma.authSession.findFirst({
      where: { id: request.admin.sessionId, userId: request.admin.userId, scope: "ADMIN", revokedAt: null, expiresAt: { gt: new Date() } },
      select: { csrfTokenHash: true },
    });
    if (!session?.csrfTokenHash || !tokenHashMatches(csrfToken, session.csrfTokenHash)) {
      throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid admin session or CSRF token");
    }
  });
});
