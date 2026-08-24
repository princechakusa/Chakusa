import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { revokeAllSessions } from "../auth/auth.service.js";
import { recordAdminAudit, type AdminAuditActor, type AdminAuditContext } from "./adminAudit.service.js";

export async function resetBusinessOnboarding(
  actor: AdminAuditActor,
  businessId: string,
  confirmation: string,
  context: AdminAuditContext,
) {
  return prisma.$transaction(async (tx) => {
    const business = await tx.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, onboardingCompletedAt: true } });
    if (!business) throw ApiError.notFound("Business not found");
    if (confirmation !== business.name) throw ApiError.badRequest("Enter the exact business name to confirm onboarding reset");
    if (!business.onboardingCompletedAt) throw ApiError.conflict("Business onboarding is already incomplete");
    const updated = await tx.business.update({ where: { id: business.id }, data: { onboardingCompletedAt: null }, select: { id: true, name: true, onboardingCompletedAt: true } });
    await recordAdminAudit({ actor, action: "BUSINESS_ONBOARDING_RESET", targetType: "business", targetId: business.id, oldValue: { onboardingCompletedAt: business.onboardingCompletedAt }, newValue: { onboardingCompletedAt: null }, context }, tx);
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function revokeUserSessions(
  actor: AdminAuditActor,
  userId: string,
  confirmation: string,
  context: AdminAuditContext,
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) throw ApiError.notFound("User not found");
    if (confirmation.toLowerCase() !== user.email.toLowerCase()) throw ApiError.badRequest("Enter the exact user email to confirm session revocation");
    const result = await revokeAllSessions(user.id, "admin_revoked", tx);
    await recordAdminAudit({ actor, action: "USER_SESSIONS_REVOKED", targetType: "user", targetId: user.id, oldValue: { activeSessionCount: result.count }, newValue: { activeSessionCount: 0 }, context }, tx);
    return { userId: user.id, revokedSessionCount: result.count };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
