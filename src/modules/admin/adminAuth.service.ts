import { randomUUID } from "node:crypto";
import type { AdminRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { normalizeEmail } from "../../lib/email.js";
import { verifyPasswordConstantTime } from "../../lib/password.js";
import { ApiError } from "../../lib/errors.js";
import { generateOpaqueToken, parseOpaqueToken, tokenHashMatches } from "../../lib/authTokens.js";
import { createSession, rotateRefreshToken } from "../auth/auth.service.js";
import { recordAdminAudit, type AdminAuditActor, type AdminAuditContext } from "./adminAudit.service.js";
import { permissionsForAdminRole } from "./admin.permissions.js";

export interface AdminLoginInput { email: string; password: string }

function actorFromMembership(membership: { id: string; userId: string; role: AdminRole; user: { email: string } }): AdminAuditActor {
  return { membershipId: membership.id, userId: membership.userId, email: membership.user.email, role: membership.role };
}

export async function authenticateAdminUser(input: AdminLoginInput, context: AdminAuditContext) {
  const user = await prisma.user.findUnique({
    where: { normalizedEmail: normalizeEmail(input.email) },
    include: { adminMembership: true },
  });
  const valid = await verifyPasswordConstantTime(user?.passwordHash, input.password);
  if (!user || !valid || user.adminMembership?.status !== "ACTIVE") {
    throw ApiError.auth(401, "AUTH_INVALID_CREDENTIALS", "Invalid admin email or password");
  }
  if (user.adminMembership.mfaRequired) {
    throw ApiError.forbidden("This admin account requires multi-factor authentication, but no MFA challenge has been completed");
  }

  const csrf = generateOpaqueToken();
  const result = await prisma.$transaction(async (tx) => {
    const membership = await tx.adminMembership.findFirst({
      where: { id: user.adminMembership!.id, userId: user.id, status: "ACTIVE" },
      include: { user: { select: { email: true } } },
    });
    if (!membership) throw ApiError.auth(401, "AUTH_INVALID_CREDENTIALS", "Invalid admin email or password");

    const auth = await createSession(user.id, tx, randomUUID(), {
      scope: "ADMIN",
      csrfTokenHash: csrf.hash,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    await recordAdminAudit({
      actor: actorFromMembership(membership),
      action: "ADMIN_LOGIN",
      targetType: "admin_session",
      targetId: auth.session.id,
      newValue: { scope: "ADMIN" },
      context,
    }, tx);
    return { membership, ...auth };
  });

  return {
    user: { id: user.id, email: user.email, fullName: user.fullName },
    membership: { id: result.membership.id, role: result.membership.role },
    permissions: permissionsForAdminRole(result.membership.role),
    session: result.session,
    refreshToken: result.refreshToken,
    csrfToken: csrf.raw,
  };
}

export async function rotateAdminRefreshToken(rawToken: string, csrfToken: string, context: AdminAuditContext) {
  const id = parseOpaqueToken(rawToken);
  if (!id) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid admin refresh token");
  const current = await prisma.authSession.findUnique({
    where: { id },
    include: { user: { include: { adminMembership: true } } },
  });
  if (
    !current ||
    current.scope !== "ADMIN" ||
    !current.csrfTokenHash ||
    !tokenHashMatches(rawToken, current.tokenHash) ||
    !tokenHashMatches(csrfToken, current.csrfTokenHash) ||
    current.user.adminMembership?.status !== "ACTIVE"
  ) {
    throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid admin session or CSRF token");
  }

  const membership = current.user.adminMembership;
  const actor = { membershipId: membership.id, userId: current.userId, email: current.user.email, role: membership.role } satisfies AdminAuditActor;
  const rotated = await rotateRefreshToken(rawToken, "ADMIN", async (tx, oldSession, newSession) => {
    await recordAdminAudit({
      actor,
      action: "ADMIN_SESSION_REFRESHED",
      targetType: "admin_session",
      targetId: newSession.id,
      oldValue: { sessionId: oldSession.id },
      newValue: { sessionId: newSession.id },
      context,
    }, tx);
  });
  return { ...rotated, csrfToken };
}

async function resolveActorFromRefreshToken(rawToken: string) {
  const id = parseOpaqueToken(rawToken);
  if (!id) return null;
  const session = await prisma.authSession.findUnique({
    where: { id },
    include: { user: { include: { adminMembership: true } } },
  });
  const membership = session?.user.adminMembership;
  if (!session || session.scope !== "ADMIN" || !membership || !tokenHashMatches(rawToken, session.tokenHash)) return null;
  return { session, actor: { membershipId: membership.id, userId: session.userId, email: session.user.email, role: membership.role } satisfies AdminAuditActor };
}

export async function logoutAdminSession(rawToken: string, csrfToken: string, context: AdminAuditContext): Promise<void> {
  const resolved = await resolveActorFromRefreshToken(rawToken);
  if (!resolved?.session.csrfTokenHash || !tokenHashMatches(csrfToken, resolved.session.csrfTokenHash)) {
    throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid admin session or CSRF token");
  }
  await prisma.$transaction(async (tx) => {
    await tx.authSession.updateMany({
      where: { familyId: resolved.session.familyId, scope: "ADMIN", revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "admin_logout" },
    });
    await recordAdminAudit({
      actor: resolved.actor,
      action: "ADMIN_LOGOUT",
      targetType: "admin_session_family",
      targetId: resolved.session.familyId,
      context,
    }, tx);
  });
}

export async function listOwnAdminSessions(userId: string) {
  const sessions = await prisma.authSession.findMany({
    where: { userId, scope: "ADMIN" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  return sessions.map((session) => ({
    id: session.id,
    ipAddress: session.ipAddress,
    userAgent: session.userAgent,
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
    expiresAt: session.expiresAt,
    status: session.revokedAt ? "revoked" as const : session.expiresAt <= new Date() ? "expired" as const : "active" as const,
  }));
}

export async function revokeOwnAdminSession(
  actor: AdminAuditActor,
  sessionId: string,
  context: AdminAuditContext,
) {
  await prisma.$transaction(async (tx) => {
    const session = await tx.authSession.findFirst({ where: { id: sessionId, userId: actor.userId, scope: "ADMIN" } });
    if (!session) throw ApiError.notFound("Admin session not found");
    await tx.authSession.updateMany({
      where: { familyId: session.familyId, userId: actor.userId, scope: "ADMIN", revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "admin_session_revoked" },
    });
    await recordAdminAudit({
      actor,
      action: "ADMIN_SESSION_REVOKED",
      targetType: "admin_session_family",
      targetId: session.familyId,
      oldValue: { revoked: false },
      newValue: { revoked: true },
      context,
    }, tx);
  });
}

export async function revokeAllAdminSessions(actor: AdminAuditActor, context: AdminAuditContext) {
  await prisma.$transaction(async (tx) => {
    const result = await tx.authSession.updateMany({
      where: { userId: actor.userId, scope: "ADMIN", revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "admin_logout_all" },
    });
    await recordAdminAudit({
      actor,
      action: "ADMIN_LOGOUT_ALL",
      targetType: "admin_user",
      targetId: actor.userId,
      newValue: { revokedSessionCount: result.count },
      context,
    }, tx);
  });
}
