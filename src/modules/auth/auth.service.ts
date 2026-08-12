import { randomBytes, randomUUID } from "node:crypto";
import { AuthChallengePurpose, Prisma } from "@prisma/client";
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

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

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

export async function createSession(userId: string, db: DatabaseClient, familyId: string = randomUUID()) {
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

export async function authenticateGoogleIdentity(identity: VerifiedGoogleIdentity, serializationRetries = 0) {
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

      const existingEmail = await tx.user.findUnique({
        where: { normalizedEmail: normalizeEmail(identity.email) },
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
          normalizedEmail: normalizeEmail(identity.email),
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
      const auth = await createSession(user.id, tx);
      return { user, isNewUser: true, ...auth };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && serializationRetries < 2) {
      return authenticateGoogleIdentity(identity, serializationRetries + 1);
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
      return { user, isNewUser: true, ...await createSession(user.id, tx) };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && serializationRetries < 2) {
      return authenticateAppleIdentity(identity, refreshToken, proof, name, serializationRetries + 1);
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

export async function deleteAccountWithApple(userId: string, providerSubject: string, proof: AppleChallengeProof) {
  await prisma.$transaction(async (tx) => {
    await claimAppleChallenge(tx, proof, "APPLE_DELETE", userId);
    const identity = await tx.authIdentity.findUnique({ where: { provider_providerSubject: { provider: "APPLE", providerSubject } } });
    if (!identity || identity.userId !== userId) {
      throw ApiError.auth(401, "AUTH_REAUTHENTICATION_REQUIRED", "Apple account confirmation failed");
    }
    await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "account_deleted" } });
    await tx.user.delete({ where: { id: userId } });
  }, { isolationLevel: "Serializable" });
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
  // Always run the same-cost Argon2id verification, even when the user
  // doesn't exist, so response timing can't be used to enumerate emails.
  const valid = await verifyPasswordConstantTime(user?.passwordHash, input.password);
  if (!user || !valid) {
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
