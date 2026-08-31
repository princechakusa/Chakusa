import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { normalizeEmail } from "../../lib/email.js";
import { hashPassword, verifyPasswordConstantTime } from "../../lib/password.js";
import { ensureCustomerProfile, findMatchingBusinessCustomers, linkCustomerToBusiness } from "../../lib/customer/customerContext.js";
import { createEmailVerification } from "../../lib/customer/emailVerification.js";
import {
  authenticateAppleIdentity,
  authenticateGoogleIdentity,
  createSession,
  rotateRefreshToken,
} from "../auth/auth.service.js";
import type { VerifiedGoogleIdentity } from "../auth/googleVerifier.js";

// PROGRAM 2 LOOP 1: customer identity. Reuses the User/AuthIdentity/
// AuthSession machinery and auth.service's OAuth resolution; the only new
// concepts are the CUSTOMER session scope and the CustomerProfile.

interface SessionAttrs {
  ipAddress?: string | null;
  userAgent?: string | null;
}

async function autoLinkKnownBusinesses(profileId: string) {
  const matches = await findMatchingBusinessCustomers(profileId);
  for (const match of matches) {
    await linkCustomerToBusiness({ customerProfileId: profileId, businessId: match.businessId, businessCustomerId: match.id }).catch(() => undefined);
  }
}

export async function registerCustomer(input: {
  email: string;
  password: string;
  fullName: string;
  displayName?: string | null;
  phone?: string | null;
  attrs?: SessionAttrs;
}) {
  const normalizedEmail = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { normalizedEmail }, include: { customerProfile: true } });
    if (existing?.customerProfile) throw ApiError.conflict("A customer account with this email already exists");

    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data: existing.passwordHash ? {} : { passwordHash } })
      : await tx.user.create({ data: { email: normalizedEmail, normalizedEmail, passwordHash, fullName: input.fullName } });

    const profile = await ensureCustomerProfile(
      user.id,
      { displayName: input.displayName ?? input.fullName, phone: input.phone ?? null },
      tx as unknown as Prisma.TransactionClient,
    );
    const { session, refreshToken } = await createSession(user.id, tx, undefined, { scope: "CUSTOMER", ...input.attrs });
    return { user, profile, session, refreshToken };
  });

  const verificationToken = await createEmailVerification(result.user.id, result.user.email).catch(() => null);
  await autoLinkKnownBusinesses(result.profile.id).catch(() => undefined);
  return { ...result, verificationToken };
}

export async function loginCustomer(input: { email: string; password: string; attrs?: SessionAttrs }) {
  const user = await prisma.user.findUnique({
    where: { normalizedEmail: normalizeEmail(input.email) },
    include: { customerProfile: true },
  });
  const valid = await verifyPasswordConstantTime(user?.passwordHash, input.password);
  if (!user || !valid || user.accountStatus === "DISABLED" || !user.customerProfile) {
    throw ApiError.auth(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
  }
  if (user.customerProfile.status !== "ACTIVE") {
    throw ApiError.auth(403, "AUTH_ACCOUNT_DISABLED", "This customer account is not active");
  }
  const { session, refreshToken } = await createSession(user.id, prisma, undefined, { scope: "CUSTOMER", ...input.attrs });
  await prisma.customerProfile.update({ where: { id: user.customerProfile.id }, data: { lastSeenAt: new Date() } });
  return { user, profile: user.customerProfile, session, refreshToken };
}

/** Reuses auth.service's Google resolution, then swaps to a CUSTOMER session. */
export async function customerGoogleSignIn(identity: VerifiedGoogleIdentity, attrs?: SessionAttrs) {
  const resolved = await authenticateGoogleIdentity(identity);
  await prisma.authSession.update({ where: { id: resolved.session.id }, data: { revokedAt: new Date(), revokeReason: "reissued_customer_scope" } });
  const profile = await ensureCustomerProfile(resolved.user.id, { displayName: resolved.user.fullName });
  const { session, refreshToken } = await createSession(resolved.user.id, prisma, undefined, { scope: "CUSTOMER", ...attrs });
  await autoLinkKnownBusinesses(profile.id).catch(() => undefined);
  return { user: resolved.user, profile, session, refreshToken, isNewUser: resolved.isNewUser };
}

export async function customerAppleSignIn(
  identity: Parameters<typeof authenticateAppleIdentity>[0],
  appleRefreshToken: string,
  proof: Parameters<typeof authenticateAppleIdentity>[2],
  nameInput: Parameters<typeof authenticateAppleIdentity>[3],
  attrs?: SessionAttrs,
) {
  const resolved = await authenticateAppleIdentity(identity, appleRefreshToken, proof, nameInput);
  await prisma.authSession.update({ where: { id: resolved.session.id }, data: { revokedAt: new Date(), revokeReason: "reissued_customer_scope" } });
  const profile = await ensureCustomerProfile(resolved.user.id, { displayName: resolved.user.fullName });
  const { session, refreshToken } = await createSession(resolved.user.id, prisma, undefined, { scope: "CUSTOMER", ...attrs });
  await autoLinkKnownBusinesses(profile.id).catch(() => undefined);
  return { user: resolved.user, profile, session, refreshToken, isNewUser: resolved.isNewUser };
}

export function refreshCustomerSession(rawToken: string) {
  return rotateRefreshToken(rawToken, "CUSTOMER");
}

export async function revokeCustomerSession(userId: string, sessionId: string) {
  const revoked = await prisma.authSession.updateMany({
    where: { id: sessionId, userId, scope: "CUSTOMER", revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: "customer_revoked" },
  });
  if (!revoked.count) throw ApiError.notFound("Session not found");
}

export async function revokeAllCustomerSessions(userId: string, reason = "customer_logout_all") {
  const result = await prisma.authSession.updateMany({
    where: { userId, scope: "CUSTOMER", revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
  return { revoked: result.count };
}

export async function listCustomerSessions(userId: string) {
  return prisma.authSession.findMany({
    where: { userId, scope: "CUSTOMER", revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    select: { id: true, ipAddress: true, userAgent: true, lastUsedAt: true, createdAt: true, expiresAt: true },
  });
}

export async function getCustomerAuthContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      emailVerifiedAt: true,
      passwordHash: true,
      authIdentities: { select: { provider: true } },
      customerProfile: true,
    },
  });
  if (!user?.customerProfile) throw ApiError.notFound("Customer account not found");
  return {
    user: { id: user.id, email: user.email, fullName: user.fullName, emailVerified: Boolean(user.emailVerifiedAt), hasPassword: Boolean(user.passwordHash), linkedProviders: user.authIdentities.map((identity) => identity.provider) },
    profile: user.customerProfile,
  };
}
