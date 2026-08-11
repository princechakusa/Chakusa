import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { ApiError } from "../../lib/errors.js";
import { normalizeEmail } from "../../lib/email.js";
import { generateOpaqueToken, parseOpaqueToken, tokenHashMatches } from "../../lib/authTokens.js";
import { config } from "../../lib/config.js";
import type { RegisterInput, LoginInput } from "./auth.schemas.js";

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

const refreshExpiry = () => new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

async function createSession(userId: string, db: DatabaseClient, familyId: string = randomUUID()) {
  const token = generateOpaqueToken();
  const session = await db.authSession.create({
    data: {
      id: token.id,
      userId,
      tokenHash: token.hash,
      familyId,
      expiresAt: refreshExpiry(),
    },
  });
  return { session, refreshToken: token.raw };
}

export async function registerUser(input: RegisterInput) {
  const normalizedEmail = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { normalizedEmail } });
    if (existing) throw ApiError.conflict("An account with this email already exists");

    const user = await tx.user.create({
      data: { email: normalizedEmail, normalizedEmail, passwordHash, fullName: input.fullName },
    });
    const business = await tx.business.create({
      data: { ownerId: user.id, name: input.businessName, industry: input.industry },
    });
    await tx.businessMember.create({
      data: { businessId: business.id, userId: user.id, role: "OWNER" },
    });
    const auth = await createSession(user.id, tx);
    return { user, business, ...auth };
  });
}

export async function authenticateUser(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { normalizedEmail: normalizeEmail(input.email) },
  });
  if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
    throw ApiError.auth(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
  }
  const auth = await createSession(user.id, prisma);
  return { user, ...auth };
}

export async function rotateRefreshToken(rawToken: string) {
  const id = parseOpaqueToken(rawToken);
  if (!id) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid refresh token");

  const outcome = await prisma.$transaction(async (tx) => {
    const current = await tx.authSession.findUnique({ where: { id } });
    if (!current || !tokenHashMatches(rawToken, current.tokenHash)) return { kind: "invalid" } as const;

    if (current.revokedAt || current.rotatedAt) {
      await tx.authSession.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "refresh_token_reuse" },
      });
      return { kind: "reused" } as const;
    }
    if (current.expiresAt <= new Date()) {
      await tx.authSession.update({
        where: { id: current.id },
        data: { revokedAt: new Date(), revokeReason: "expired" },
      });
      return { kind: "expired" } as const;
    }

    const replacement = await createSession(current.userId, tx, current.familyId);
    const claimed = await tx.authSession.updateMany({
      where: { id: current.id, rotatedAt: null, revokedAt: null },
      data: { rotatedAt: new Date(), lastUsedAt: new Date(), replacedById: replacement.session.id },
    });
    if (claimed.count === 0) {
      await tx.authSession.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: "refresh_token_reuse" },
      });
      return { kind: "reused" } as const;
    }
    return { kind: "ok", userId: current.userId, ...replacement } as const;
  });

  if (outcome.kind === "invalid") throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid refresh token");
  if (outcome.kind === "expired") throw ApiError.auth(401, "AUTH_SESSION_EXPIRED", "Refresh session expired");
  if (outcome.kind === "reused") throw ApiError.auth(401, "AUTH_REFRESH_REUSED", "Refresh token reuse detected");
  return outcome;
}

export async function revokeSessionFamily(rawToken: string, userId?: string) {
  const id = parseOpaqueToken(rawToken);
  if (!id) return;
  const session = await prisma.authSession.findUnique({ where: { id } });
  if (!session || !tokenHashMatches(rawToken, session.tokenHash) || (userId && session.userId !== userId)) return;
  await prisma.authSession.updateMany({
    where: { familyId: session.familyId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: "logout" },
  });
}

export async function revokeAllSessions(userId: string, reason = "logout_all") {
  await prisma.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
}

export async function createPasswordReset(email: string): Promise<string | null> {
  const token = generateOpaqueToken();
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { normalizedEmail: normalizeEmail(email) } });
    if (!user?.passwordHash) return null;
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await tx.passwordResetToken.create({
      data: {
        id: token.id,
        userId: user.id,
        tokenHash: token.hash,
        expiresAt: new Date(Date.now() + config.PASSWORD_RESET_TTL_MINUTES * 60_000),
      },
    });
    return token.raw;
  });
}

export async function resetPassword(rawToken: string, password: string) {
  const id = parseOpaqueToken(rawToken);
  if (!id) throw ApiError.auth(400, "AUTH_RESET_TOKEN_INVALID", "Invalid password reset token");
  const passwordHash = await hashPassword(password);

  const outcome = await prisma.$transaction(async (tx) => {
    const reset = await tx.passwordResetToken.findUnique({ where: { id } });
    if (!reset || !tokenHashMatches(rawToken, reset.tokenHash)) return "invalid" as const;
    if (reset.usedAt) return "used" as const;
    if (reset.expiresAt <= new Date()) return "expired" as const;

    const claimed = await tx.passwordResetToken.updateMany({
      where: { id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) return "used" as const;
    await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
    await tx.authSession.updateMany({
      where: { userId: reset.userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "password_reset" },
    });
    return "ok" as const;
  });

  if (outcome === "invalid") throw ApiError.auth(400, "AUTH_RESET_TOKEN_INVALID", "Invalid password reset token");
  if (outcome === "expired") throw ApiError.auth(400, "AUTH_RESET_TOKEN_EXPIRED", "Password reset token expired");
  if (outcome === "used") throw ApiError.auth(400, "AUTH_RESET_TOKEN_USED", "Password reset token has already been used");
}

export async function deleteAccount(userId: string, password: string) {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Authentication session is invalid");
    if (!user.passwordHash) {
      throw ApiError.auth(409, "AUTH_PASSWORD_UNAVAILABLE", "This account does not have a password");
    }
    if (!(await verifyPassword(user.passwordHash, password))) {
      throw ApiError.auth(401, "AUTH_REAUTHENTICATION_REQUIRED", "Password confirmation failed");
    }
    await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "account_deleted" },
    });
    await tx.user.delete({ where: { id: userId } });
  }, { isolationLevel: "Serializable" });
}

export async function getUserContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, createdAt: true },
  });
  if (!user) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Authentication session is invalid");
  const membership = await prisma.businessMember.findFirst({
    where: { userId }, include: { business: true }, orderBy: { createdAt: "asc" },
  });
  return { user, business: membership?.business ?? null, role: membership?.role ?? null };
}
