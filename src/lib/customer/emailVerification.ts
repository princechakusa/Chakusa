import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { generateOpaqueToken, parseOpaqueToken, tokenHashMatches } from "../authTokens.js";

// PROGRAM 2 LOOP 1: generic email verification (any User). Mirrors
// PasswordResetToken — only the SHA-256 hash of the raw token is stored,
// outstanding tokens are invalidated on issue, and consumption is a
// single-claim update.

const TTL_MINUTES = 60 * 24;

export async function createEmailVerification(userId: string, email: string): Promise<string> {
  const token = generateOpaqueToken();
  await prisma.$transaction(async (tx) => {
    await tx.emailVerificationToken.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
    await tx.emailVerificationToken.create({
      data: { id: token.id, userId, email, tokenHash: token.hash, expiresAt: new Date(Date.now() + TTL_MINUTES * 60_000) },
    });
  });
  return token.raw;
}

export async function consumeEmailVerification(rawToken: string): Promise<{ userId: string }> {
  const id = parseOpaqueToken(rawToken);
  if (!id) throw ApiError.badRequest("Invalid verification token");
  const outcome = await prisma.$transaction(async (tx) => {
    const record = await tx.emailVerificationToken.findUnique({ where: { id } });
    if (!record || !tokenHashMatches(rawToken, record.tokenHash)) return "invalid" as const;
    if (record.consumedAt) return "used" as const;
    if (record.expiresAt <= new Date()) return "expired" as const;
    const claimed = await tx.emailVerificationToken.updateMany({ where: { id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
    if (claimed.count !== 1) return "used" as const;
    await tx.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } });
    await tx.customerProfile.updateMany({ where: { userId: record.userId, verifiedAt: null }, data: { verifiedAt: new Date() } });
    return { userId: record.userId } as const;
  });
  if (outcome === "invalid") throw ApiError.badRequest("Invalid verification token");
  if (outcome === "expired") throw ApiError.badRequest("Verification token expired");
  if (outcome === "used") throw ApiError.badRequest("Verification token has already been used");
  return outcome;
}
