import { randomBytes, randomUUID } from "node:crypto";
import { AuthChallengePurpose, Prisma, type AuthSession, type AuthSessionScope } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { hashPassword, verifyPassword, verifyPasswordConstantTime } from "../../lib/password.js";
import { ApiError } from "../../lib/errors.js";
import { normalizeEmail } from "../../lib/email.js";
import { generateOpaqueToken, parseOpaqueToken, tokenHashMatches } from "../../lib/authTokens.js";
import { config } from "../../lib/config.js";
import type { RegisterInput, LoginInput } from "./auth.schemas.js";
import type { VerifiedGoogleIdentity } from "./googleVerifier.js";
import type { VerifiedAppleIdentity } from "./appleAuth.js";
import { appleChallengeHash } from "./appleAuth.js";
import { decryptProviderCredential, encryptProviderCredential } from "../../lib/providerCredentials.js";
import { claimInvitationForNewUser } from "../team/teamInvitations.service.js";
import { recordActivity } from "../../lib/activity.js";
import { withLimitCheck } from "../../lib/entitlements.js";
import { generatePublicSlug } from "../../lib/publicSlug.js";
import type { BusinessRole } from "@prisma/client";

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

/**
 * Business Phase 1 critical fix (see the Phase 1 report's "owner-deletion
 * protection" section): Business.owner has onDelete: Cascade, so deleting
 * a User who owns a business previously cascade-deleted that ENTIRE
 * business — including every other team member's BusinessMember row and
 * all of the business's data — the instant the owner deleted their own
 * account, with no warning and no way back. This blocks that outcome
 * outright rather than attempting an ownership-transfer flow, which this
 * phase deliberately does not build (see teamMembers.service.ts's doc
 * comments on why ownership stays immutable in v1): an owner who currently
 * has any other ACTIVE team member must remove them (or wait for them to
 * leave) before they can delete their own account. Called inside the same
 * transaction as the deletion itself, immediately before tx.user.delete,
 * so this check and the deletion it guards can never race.
 */
async function assertAccountDeletionSafe(userId: string, tx: DatabaseClient): Promise<void> {
  const ownedBusinesses = await tx.business.findMany({ where: { ownerId: userId }, select: { id: true } });
  for (const business of ownedBusinesses) {
    const otherActiveMembers = await tx.businessMember.count({
      where: { businessId: business.id, userId: { not: userId }, status: "ACTIVE" },
    });
    if (otherActiveMembers > 0) {
      throw ApiError.conflict("Remove all other team members before deleting an account that owns a business with active staff");
    }
  }
}

const refreshExpiry = () => new Date(Date.now() + config.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

export interface AppleChallengeProof { challengeId: string; nonce: string; state: string; }

export async function createAppleChallenge(purpose: AuthChallengePurpose, userId?: string) {
  if (!config.APPLE_AUTH_ENABLED) {
    throw ApiError.auth(503, "APPLE_AUTH_NOT_CONFIGURED", "Apple authentication is not configured");
  }
  const nonce = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const challenge = await prisma.authChallenge.create({
    data: {
      userId,
      purpose,
      nonceHash: appleChallengeHash(nonce),
      stateHash: appleChallengeHash(state),
      expiresAt: new Date(Date.now() + config.APPLE_CHALLENGE_TTL_MINUTES * 60_000),
    },
  });
  return { challengeId: challenge.id, nonce, state, expiresAt: challenge.expiresAt };
}

export async function validateAppleChallenge(proof: AppleChallengeProof, purpose: AuthChallengePurpose, userId?: string) {
  const challenge = await prisma.authChallenge.findUnique({ where: { id: proof.challengeId } });
  if (!challenge || challenge.purpose !== purpose || challenge.userId !== (userId ?? null) ||
      challenge.nonceHash !== appleChallengeHash(proof.nonce) || challenge.stateHash !== appleChallengeHash(proof.state)) {
    throw ApiError.auth(401, "APPLE_CHALLENGE_INVALID", "Apple authentication challenge is invalid");
  }
  if (challenge.usedAt) throw ApiError.auth(401, "APPLE_CHALLENGE_USED", "Apple authentication challenge has already been used");
  if (challenge.expiresAt <= new Date()) throw ApiError.auth(401, "APPLE_CHALLENGE_EXPIRED", "Apple authentication challenge has expired");
}

async function claimAppleChallenge(tx: Prisma.TransactionClient, proof: AppleChallengeProof, purpose: AuthChallengePurpose, userId?: string) {
  const claimed = await tx.authChallenge.updateMany({
    where: {
      id: proof.challengeId,
      purpose,
      userId: userId ?? null,
      nonceHash: appleChallengeHash(proof.nonce),
      stateHash: appleChallengeHash(proof.state),
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) throw ApiError.auth(401, "APPLE_CHALLENGE_USED", "Apple authentication challenge is no longer valid");
}

interface CreateSessionAttributes {
  scope?: AuthSessionScope;
  csrfTokenHash?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function createSession(
  userId: string,
  db: DatabaseClient,
  familyId: string = randomUUID(),
  attributes: CreateSessionAttributes = {},
) {
  const token = generateOpaqueToken();
  const session = await db.authSession.create({
    data: {
      id: token.id,
      userId,
      tokenHash: token.hash,
      familyId,
      expiresAt: refreshExpiry(),
      scope: attributes.scope,
      csrfTokenHash: attributes.csrfTokenHash,
      ipAddress: attributes.ipAddress,
      userAgent: attributes.userAgent,
    },
  });
  return { session, refreshToken: token.raw };
}

/**
 * Business Phase 1.1: like registerInvitedUser, but for the Google
 * sign-in new-user branch below. Unlike password registration, Google/Apple
 * sign-in for a brand-new user never creates a Business on its own (see
 * business.routes.ts's POST / doc comment — business creation there is a
 * separate, later authenticated call, part of mobile's onboarding). So
 * there is no "unconditional business creation" to override here: joining
 * the invited Business is purely additive to what this branch already does.
 */
async function joinInvitedBusinessIfTokenPresent(
  tx: Prisma.TransactionClient,
  invitationToken: string | undefined,
  normalizedEmail: string,
  userId: string,
): Promise<void> {
  if (!invitationToken) return;
  const claim = await claimInvitationForNewUser(tx, invitationToken, normalizedEmail);
  if (claim.outcome !== "claimed") throw invitationClaimError(claim.outcome);
  await tx.businessMember.create({
    data: { businessId: claim.businessId, userId, role: claim.role, status: "ACTIVE" },
  });
  await recordActivity(
    { businessId: claim.businessId, actorId: userId, eventType: "TEAM_MEMBER_JOINED", entityType: "business_member", entityId: userId },
    tx,
  );
}

export async function authenticateGoogleIdentity(identity: VerifiedGoogleIdentity, invitationToken?: string, serializationRetries = 0) {
  try {
    return await prisma.$transaction(async (tx) => {
      const linked = await tx.authIdentity.findUnique({
        where: { provider_providerSubject: { provider: "GOOGLE", providerSubject: identity.providerSubject } },
        include: { user: true },
      });
      if (linked) {
        await tx.authIdentity.update({
          where: { id: linked.id },
          data: { providerEmail: identity.email, providerEmailVerified: true },
        });
        const auth = await createSession(linked.userId, tx);
        return { user: linked.user, isNewUser: false, ...auth };
      }

      const normalizedEmail = normalizeEmail(identity.email);
      const existingEmail = await tx.user.findUnique({
        where: { normalizedEmail },
      });
      if (existingEmail) {
        throw ApiError.auth(
          409,
          "ACCOUNT_LINK_REQUIRED",
          "An account with this email already exists. Sign in with your password, then link Google in Settings.",
        );
      }

      const user = await tx.user.create({
        data: {
          email: identity.email,
          normalizedEmail,
          passwordHash: null,
          emailVerifiedAt: new Date(),
          fullName: identity.fullName,
          authIdentities: {
            create: {
              provider: "GOOGLE",
              providerSubject: identity.providerSubject,
              providerEmail: identity.email,
              providerEmailVerified: true,
            },
          },
        },
      });
      await joinInvitedBusinessIfTokenPresent(tx, invitationToken, normalizedEmail, user.id);
      const auth = await createSession(user.id, tx);
      return { user, isNewUser: true, ...auth };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && serializationRetries < 2) {
      return authenticateGoogleIdentity(identity, invitationToken, serializationRetries + 1);
    }
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }

    const linked = await prisma.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: "GOOGLE", providerSubject: identity.providerSubject } },
      include: { user: true },
    });
    if (linked) {
      const auth = await createSession(linked.userId, prisma);
      return { user: linked.user, isNewUser: false, ...auth };
    }
    const existingEmail = await prisma.user.findUnique({
      where: { normalizedEmail: normalizeEmail(identity.email) },
    });
    if (existingEmail) {
      throw ApiError.auth(409, "ACCOUNT_LINK_REQUIRED", "This Google identity must be linked from the existing account");
    }
    throw ApiError.auth(409, "AUTH_IDENTITY_CONFLICT", "Google identity could not be created safely");
  }
}

export async function linkGoogleIdentity(userId: string, identity: VerifiedGoogleIdentity, serializationRetries = 0) {
  try {
    return await prisma.$transaction(async (tx) => {
      const subjectIdentity = await tx.authIdentity.findUnique({
        where: { provider_providerSubject: { provider: "GOOGLE", providerSubject: identity.providerSubject } },
      });
      if (subjectIdentity && subjectIdentity.userId !== userId) {
        throw ApiError.auth(409, "AUTH_IDENTITY_CONFLICT", "This Google account is linked to another Chakusa account");
      }
      if (subjectIdentity) {
        return tx.authIdentity.update({
          where: { id: subjectIdentity.id },
          data: { providerEmail: identity.email, providerEmailVerified: true },
        });
      }

      const currentProvider = await tx.authIdentity.findUnique({
        where: { userId_provider: { userId, provider: "GOOGLE" } },
      });
      if (currentProvider) {
        throw ApiError.auth(409, "AUTH_PROVIDER_ALREADY_LINKED", "A different Google account is already linked");
      }

      const emailOwner = await tx.user.findUnique({
        where: { normalizedEmail: normalizeEmail(identity.email) },
        select: { id: true },
      });
      if (emailOwner && emailOwner.id !== userId) {
        throw ApiError.auth(409, "AUTH_IDENTITY_CONFLICT", "This Google email belongs to a different Chakusa account");
      }

      return tx.authIdentity.create({
        data: {
          userId,
          provider: "GOOGLE",
          providerSubject: identity.providerSubject,
          providerEmail: identity.email,
          providerEmailVerified: true,
        },
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && serializationRetries < 2) {
      return linkGoogleIdentity(userId, identity, serializationRetries + 1);
    }
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }
    const subjectIdentity = await prisma.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: "GOOGLE", providerSubject: identity.providerSubject } },
    });
    if (subjectIdentity?.userId === userId) return subjectIdentity;
    if (subjectIdentity) {
      throw ApiError.auth(409, "AUTH_IDENTITY_CONFLICT", "This Google account is linked to another Chakusa account");
    }
    throw ApiError.auth(409, "AUTH_PROVIDER_ALREADY_LINKED", "A different Google account is already linked");
  }
}

function appleDisplayName(email: string, name?: { givenName?: string | null; familyName?: string | null }) {
  const supplied = [name?.givenName, name?.familyName].map((part) => part?.trim()).filter(Boolean).join(" ");
  return supplied || email.split("@")[0] || "Chakusa User";
}

export async function authenticateAppleIdentity(
  identity: VerifiedAppleIdentity,
  refreshToken: string,
  proof: AppleChallengeProof,
  name?: { givenName?: string | null; familyName?: string | null },
  invitationToken?: string,
  serializationRetries = 0,
) {
  const encryptedRefreshToken = encryptProviderCredential(refreshToken);
  try {
    return await prisma.$transaction(async (tx) => {
      await claimAppleChallenge(tx, proof, "APPLE_SIGN_IN");
      const linked = await tx.authIdentity.findUnique({
        where: { provider_providerSubject: { provider: "APPLE", providerSubject: identity.providerSubject } },
        include: { user: true },
      });
      if (linked) {
        await tx.authIdentity.update({ where: { id: linked.id }, data: {
          providerEmail: identity.email,
          providerEmailVerified: true,
          encryptedRefreshToken,
          credentialUpdatedAt: new Date(),
        } });
        return { user: linked.user, isNewUser: false, ...await createSession(linked.userId, tx) };
      }
      const normalizedEmail = normalizeEmail(identity.email);
      if (await tx.user.findUnique({ where: { normalizedEmail } })) {
        throw ApiError.auth(409, "ACCOUNT_LINK_REQUIRED", "An account with this email already exists. Sign in, then link Apple in Settings.");
      }
      const user = await tx.user.create({ data: {
        email: normalizedEmail,
        normalizedEmail,
        passwordHash: null,
        emailVerifiedAt: new Date(),
        fullName: appleDisplayName(identity.email, name),
        authIdentities: { create: {
          provider: "APPLE",
          providerSubject: identity.providerSubject,
          providerEmail: identity.email,
          providerEmailVerified: true,
          encryptedRefreshToken,
          credentialUpdatedAt: new Date(),
        } },
      } });
      await joinInvitedBusinessIfTokenPresent(tx, invitationToken, normalizedEmail, user.id);
      return { user, isNewUser: true, ...await createSession(user.id, tx) };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && serializationRetries < 2) {
      return authenticateAppleIdentity(identity, refreshToken, proof, name, invitationToken, serializationRetries + 1);
    }
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    throw ApiError.auth(409, "AUTH_IDENTITY_CONFLICT", "Apple identity could not be created safely");
  }
}

export async function linkAppleIdentity(
  userId: string,
  identity: VerifiedAppleIdentity,
  refreshToken: string,
  proof: AppleChallengeProof,
) {
  const encryptedRefreshToken = encryptProviderCredential(refreshToken);
  return prisma.$transaction(async (tx) => {
    await claimAppleChallenge(tx, proof, "APPLE_LINK", userId);
    const subjectIdentity = await tx.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: "APPLE", providerSubject: identity.providerSubject } },
    });
    if (subjectIdentity && subjectIdentity.userId !== userId) {
      throw ApiError.auth(409, "AUTH_IDENTITY_CONFLICT", "This Apple account is linked to another Chakusa account");
    }
    if (subjectIdentity) return tx.authIdentity.update({ where: { id: subjectIdentity.id }, data: {
      providerEmail: identity.email, providerEmailVerified: true, encryptedRefreshToken, credentialUpdatedAt: new Date(),
    } });
    if (await tx.authIdentity.findUnique({ where: { userId_provider: { userId, provider: "APPLE" } } })) {
      throw ApiError.auth(409, "AUTH_PROVIDER_ALREADY_LINKED", "A different Apple account is already linked");
    }
    const emailOwner = await tx.user.findUnique({ where: { normalizedEmail: normalizeEmail(identity.email) }, select: { id: true } });
    if (emailOwner && emailOwner.id !== userId) {
      throw ApiError.auth(409, "AUTH_IDENTITY_CONFLICT", "This Apple email belongs to a different Chakusa account");
    }
    return tx.authIdentity.create({ data: {
      userId, provider: "APPLE", providerSubject: identity.providerSubject, providerEmail: identity.email,
      providerEmailVerified: true, encryptedRefreshToken, credentialUpdatedAt: new Date(),
    } });
  }, { isolationLevel: "Serializable" });
}

export async function getAppleDeletionCredential(userId: string) {
  const identity = await prisma.authIdentity.findUnique({ where: { userId_provider: { userId, provider: "APPLE" } } });
  if (!identity?.encryptedRefreshToken) {
    throw ApiError.auth(409, "AUTH_REAUTHENTICATION_REQUIRED", "A linked Apple account is required for Apple account deletion");
  }
  return { providerSubject: identity.providerSubject, refreshToken: decryptProviderCredential(identity.encryptedRefreshToken) };
}

export async function getOptionalAppleDeletionCredential(userId: string) {
  const identity = await prisma.authIdentity.findUnique({ where: { userId_provider: { userId, provider: "APPLE" } } });
  if (!identity?.encryptedRefreshToken) return null;
  return { providerSubject: identity.providerSubject, refreshToken: decryptProviderCredential(identity.encryptedRefreshToken) };
}

export async function verifyAccountPassword(userId: string, password: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Authentication session is invalid");
  if (!user.passwordHash) throw ApiError.auth(409, "AUTH_PASSWORD_UNAVAILABLE", "This account does not have a password");
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw ApiError.auth(401, "AUTH_REAUTHENTICATION_REQUIRED", "Password confirmation failed");
  }
}

export async function updateUserProfile(userId: string, fullName: string) {
  return prisma.user.update({ where: { id: userId }, data: { fullName }, select: { id: true, email: true, fullName: true } });
}

export async function changeAccountPassword(userId: string, sessionId: string, currentPassword: string | undefined, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Authentication session is invalid");
  if (user.passwordHash && (!currentPassword || !await verifyPassword(user.passwordHash, currentPassword))) throw ApiError.auth(401, "AUTH_REAUTHENTICATION_REQUIRED", "Current password is incorrect");
  const currentSession = await prisma.authSession.findUnique({ where: { id: sessionId }, select: { familyId: true } });
  if (!currentSession) throw ApiError.auth(401, "AUTH_SESSION_EXPIRED", "Authentication session expired");
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.authSession.updateMany({ where: { userId, familyId: { not: currentSession.familyId }, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "password_changed" } }),
  ]);
}

export async function deleteAccountWithApple(userId: string, providerSubject: string, proof: AppleChallengeProof) {
  await prisma.$transaction(async (tx) => {
    await claimAppleChallenge(tx, proof, "APPLE_DELETE", userId);
    const identity = await tx.authIdentity.findUnique({ where: { provider_providerSubject: { provider: "APPLE", providerSubject } } });
    if (!identity || identity.userId !== userId) {
      throw ApiError.auth(401, "AUTH_REAUTHENTICATION_REQUIRED", "Apple account confirmation failed");
    }
    await assertAccountDeletionSafe(userId, tx);
    await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "account_deleted" } });
    await tx.user.delete({ where: { id: userId } });
  }, { isolationLevel: "Serializable" });
}

/** Maps claimInvitationForNewUser's non-"claimed" outcomes to the same public error shapes publicTeamInvites.routes.ts's /accept endpoint already uses, so both entry points into "consume a team invitation" fail the same way for the same reasons. */
function invitationClaimError(outcome: Exclude<Awaited<ReturnType<typeof claimInvitationForNewUser>>, { outcome: "claimed" }>["outcome"]): ApiError {
  switch (outcome) {
    case "not-found":
      return ApiError.notFound("This invitation is invalid or no longer available");
    case "expired":
      return ApiError.conflict("This invitation has expired");
    case "already-used":
      return ApiError.conflict("This invitation has already been used");
    case "email-mismatch":
      // Generic — never confirm to someone registering under the wrong
      // email that the token itself was otherwise valid.
      return ApiError.notFound("This invitation is invalid or no longer available");
    case "seats-full":
      return ApiError.limitReached("staffSeats", "team seats", { limit: 0, current: 0, plan: "BUSINESS" });
  }
}

/**
 * Business Phase 1.1: registration for someone who followed a team
 * invitation link and does not yet have a Chakusa account (see
 * publicTeamInvites.routes.ts's former "KNOWN V1 GAP" doc comment, now
 * closed). Deliberately a second code path rather than a conditional bolted
 * onto the normal branch below — the two flows create structurally
 * different rows (no Business/Subscription/OWNER-membership here at all),
 * and keeping them as separate top-to-bottom blocks is what makes it
 * possible to state the "normal registration is byte-for-byte unchanged"
 * guarantee by inspection rather than by tracing conditionals through
 * shared code.
 *
 * Every value that ends up on the new BusinessMember row (businessId, role)
 * comes from the server-resolved invitation, never from `input` — there is
 * no businessId/role/ownerId field in registerSchema at all, so there is
 * nothing for a client to forge here even in principle.
 */
async function registerInvitedUser(
  tx: Prisma.TransactionClient,
  invitationToken: string,
  normalizedEmail: string,
  passwordHash: string,
  fullName: string,
) {
  const claim = await claimInvitationForNewUser(tx, invitationToken, normalizedEmail);
  if (claim.outcome !== "claimed") throw invitationClaimError(claim.outcome);

  const user = await tx.user.create({
    data: { email: normalizedEmail, normalizedEmail, passwordHash, fullName },
  });
  await tx.businessMember.create({
    data: { businessId: claim.businessId, userId: user.id, role: claim.role, status: "ACTIVE" },
  });
  await recordActivity(
    { businessId: claim.businessId, actorId: user.id, eventType: "TEAM_MEMBER_JOINED", entityType: "business_member", entityId: user.id },
    tx,
  );
  const business = await tx.business.findUniqueOrThrow({ where: { id: claim.businessId } });
  const auth = await createSession(user.id, tx);
  return { user, business, role: claim.role as BusinessRole, ...auth };
}

export async function registerUser(input: RegisterInput) {
  const normalizedEmail = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  // Serializable (via withLimitCheck's same retry-on-P2034 wrapper used
  // throughout this codebase for check-then-create races) so a
  // concurrently-accepted final seat is detected the same way
  // acceptTeamInvitation's own seat check already is — see
  // claimInvitationForNewUser's doc comment. Plain registration pays for
  // the same isolation level even though it never hits a shared resource,
  // which is a negligible cost next to keeping one transaction wrapper for
  // both branches instead of two.
  // Resolved once, outside the transaction, since it's a best-effort
  // uniqueness check against the global client rather than a write —
  // re-derived on transaction retry (same registration attempt) is fine.
  const publicSlug = input.invitationToken ? undefined : await generatePublicSlug(input.businessName!);

  return withLimitCheck(async (tx) => {
    const existing = await tx.user.findUnique({ where: { normalizedEmail } });
    if (existing) throw ApiError.conflict("An account with this email already exists");

    if (input.invitationToken) {
      return registerInvitedUser(tx, input.invitationToken, normalizedEmail, passwordHash, input.fullName);
    }

    // Unchanged normal path: businessName is guaranteed present here by
    // registerSchema's superRefine (required whenever invitationToken is
    // absent).
    const user = await tx.user.create({
      data: { email: normalizedEmail, normalizedEmail, passwordHash, fullName: input.fullName },
    });
    const business = await tx.business.create({
      data: { ownerId: user.id, name: input.businessName!, industry: input.industry, publicSlug },
    });
    await tx.businessMember.create({
      data: { businessId: business.id, userId: user.id, role: "OWNER" },
    });
    await tx.subscription.create({ data: { businessId: business.id } });
    const auth = await createSession(user.id, tx);
    return { user, business, role: "OWNER" as BusinessRole, ...auth };
  });
}

export async function authenticateUser(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { normalizedEmail: normalizeEmail(input.email) },
  });
  // Always run the same-cost Argon2id verification, even when the user
  // doesn't exist, so response timing can't be used to enumerate emails.
  const valid = await verifyPasswordConstantTime(user?.passwordHash, input.password);
  if (!user || !valid) {
    throw ApiError.auth(401, "AUTH_INVALID_CREDENTIALS", "Invalid email or password");
  }
  const auth = await createSession(user.id, prisma);
  return { user, ...auth };
}

type SessionRotationHook = (
  tx: Prisma.TransactionClient,
  current: AuthSession,
  replacement: AuthSession,
) => Promise<void>;

export async function rotateRefreshToken(
  rawToken: string,
  requiredScope: AuthSessionScope = "PRODUCT",
  onRotated?: SessionRotationHook,
) {
  const id = parseOpaqueToken(rawToken);
  if (!id) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid refresh token");

  const outcome = await prisma.$transaction(async (tx) => {
    const current = await tx.authSession.findUnique({ where: { id } });
    if (!current || current.scope !== requiredScope || !tokenHashMatches(rawToken, current.tokenHash)) return { kind: "invalid" } as const;

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

    const replacement = await createSession(current.userId, tx, current.familyId, {
      scope: current.scope,
      csrfTokenHash: current.csrfTokenHash,
      ipAddress: current.ipAddress,
      userAgent: current.userAgent,
    });
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
    await onRotated?.(tx, current, replacement.session);
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
    await assertAccountDeletionSafe(userId, tx);
    await tx.user.delete({ where: { id: userId } });
  }, { isolationLevel: "Serializable" });
}

export async function deleteAccountWithGoogle(userId: string, providerSubject: string) {
  await prisma.$transaction(async (tx) => {
    const identity = await tx.authIdentity.findUnique({
      where: { provider_providerSubject: { provider: "GOOGLE", providerSubject } },
    });
    if (!identity || identity.userId !== userId) {
      throw ApiError.auth(401, "AUTH_REAUTHENTICATION_REQUIRED", "Google account confirmation failed");
    }
    await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "account_deleted" },
    });
    await assertAccountDeletionSafe(userId, tx);
    await tx.user.delete({ where: { id: userId } });
  }, { isolationLevel: "Serializable" });
}

export async function getUserContext(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      fullName: true,
      passwordHash: true,
      createdAt: true,
      authIdentities: { select: { provider: true } },
    },
  });
  if (!user) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Authentication session is invalid");
  const membership = await prisma.businessMember.findFirst({
    where: { userId }, include: { business: true }, orderBy: { createdAt: "asc" },
  });
  const { authIdentities, passwordHash, ...publicUser } = user;
  return {
    user: { ...publicUser, hasPassword: Boolean(passwordHash), authProviders: authIdentities.map((identity) => identity.provider) },
    business: membership?.business ?? null,
    role: membership?.role ?? null,
  };
}
