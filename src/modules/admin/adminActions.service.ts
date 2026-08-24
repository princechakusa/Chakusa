import { Prisma, type AdminMembershipStatus, type AdminRole } from "@prisma/client";
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

export async function verifyBusiness(actor: AdminAuditActor, businessId: string, confirmation: string, context: AdminAuditContext) {
  return prisma.$transaction(async (tx) => {
    const business = await tx.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, verifiedAt: true, platformStatus: true } });
    if (!business) throw ApiError.notFound("Business not found");
    if (confirmation !== business.name) throw ApiError.badRequest("Enter the exact business name to confirm verification");
    if (business.verifiedAt) throw ApiError.conflict("Business is already verified");
    const updated = await tx.business.update({ where: { id: business.id }, data: { verifiedAt: new Date() }, select: { id: true, name: true, verifiedAt: true, platformStatus: true } });
    await recordAdminAudit({ actor, action: "BUSINESS_VERIFIED", targetType: "business", targetId: business.id, oldValue: { verifiedAt: null }, newValue: { verifiedAt: updated.verifiedAt }, context }, tx);
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function suspendBusiness(actor: AdminAuditActor, businessId: string, confirmation: string, reason: string, context: AdminAuditContext) {
  return prisma.$transaction(async (tx) => {
    const business = await tx.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, platformStatus: true, suspendedAt: true, suspensionReason: true } });
    if (!business) throw ApiError.notFound("Business not found");
    if (confirmation !== business.name) throw ApiError.badRequest("Enter the exact business name to confirm suspension");
    if (business.platformStatus === "SUSPENDED") throw ApiError.conflict("Business is already suspended");
    const suspendedAt = new Date();
    const updated = await tx.business.update({ where: { id: business.id }, data: { platformStatus: "SUSPENDED", suspendedAt, suspensionReason: reason }, select: { id: true, name: true, platformStatus: true, suspendedAt: true, suspensionReason: true, verifiedAt: true } });
    const canceled = await tx.automationRun.updateMany({ where: { businessId: business.id, status: "PENDING" }, data: { status: "CANCELLED", completedAt: suspendedAt, errorMessage: "Cancelled by platform suspension" } });
    await recordAdminAudit({ actor, action: "BUSINESS_SUSPENDED", targetType: "business", targetId: business.id, oldValue: { platformStatus: business.platformStatus }, newValue: { platformStatus: updated.platformStatus, suspendedAt, reason, canceledAutomationRuns: canceled.count }, context }, tx);
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function reactivateBusiness(actor: AdminAuditActor, businessId: string, confirmation: string, context: AdminAuditContext) {
  return prisma.$transaction(async (tx) => {
    const business = await tx.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, platformStatus: true, suspendedAt: true, suspensionReason: true } });
    if (!business) throw ApiError.notFound("Business not found");
    if (confirmation !== business.name) throw ApiError.badRequest("Enter the exact business name to confirm reactivation");
    if (business.platformStatus === "ACTIVE") throw ApiError.conflict("Business is already active");
    const updated = await tx.business.update({ where: { id: business.id }, data: { platformStatus: "ACTIVE", suspendedAt: null, suspensionReason: null }, select: { id: true, name: true, platformStatus: true, suspendedAt: true, suspensionReason: true, verifiedAt: true } });
    await recordAdminAudit({ actor, action: "BUSINESS_REACTIVATED", targetType: "business", targetId: business.id, oldValue: { platformStatus: business.platformStatus, suspendedAt: business.suspendedAt, reason: business.suspensionReason }, newValue: { platformStatus: updated.platformStatus }, context }, tx);
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function deleteBusiness(actor: AdminAuditActor, businessId: string, confirmation: string, reason: string, context: AdminAuditContext) {
  return prisma.$transaction(async (tx) => {
    const business = await tx.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        platformStatus: true,
        members: { select: { userId: true } },
        _count: { select: { members: true, customers: true, leads: true, messages: true, appointments: true } },
      },
    });
    if (!business) throw ApiError.notFound("Business not found");
    if (confirmation !== business.name) throw ApiError.badRequest("Enter the exact business name to confirm deletion");
    if (business.platformStatus !== "SUSPENDED") throw ApiError.conflict("Suspend the business before deleting it");

    const revoked = await tx.authSession.updateMany({
      where: { userId: { in: business.members.map((member) => member.userId) }, scope: "PRODUCT", revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "business_deleted" },
    });
    await tx.business.delete({ where: { id: business.id } });
    await recordAdminAudit({
      actor,
      action: "BUSINESS_DELETED",
      targetType: "business",
      targetId: business.id,
      oldValue: { name: business.name, platformStatus: business.platformStatus, recordCounts: business._count },
      newValue: { deleted: true, reason, revokedProductSessionCount: revoked.count },
      context,
    }, tx);
    return { id: business.id, deleted: true as const };
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

function requireExactEmail(confirmation: string, email: string) {
  if (confirmation.toLowerCase() !== email.toLowerCase()) {
    throw ApiError.badRequest("Enter the exact user email to confirm the admin access change");
  }
}

async function revokeTargetAdminSessions(tx: Prisma.TransactionClient, userId: string, reason: string) {
  return tx.authSession.updateMany({
    where: { userId, scope: "ADMIN", revokedAt: null },
    data: { revokedAt: new Date(), revokeReason: reason },
  });
}

async function requireAnotherActiveSuperAdmin(tx: Prisma.TransactionClient, membership: { id: string; role: AdminRole; status: AdminMembershipStatus }) {
  if (membership.role !== "SUPER_ADMIN" || membership.status !== "ACTIVE") return;
  const remaining = await tx.adminMembership.count({
    where: { id: { not: membership.id }, role: "SUPER_ADMIN", status: "ACTIVE" },
  });
  if (remaining === 0) throw ApiError.conflict("The final active Super Admin cannot be changed or removed");
}

export async function grantAdminAccess(
  actor: AdminAuditActor,
  userId: string,
  role: AdminRole,
  confirmation: string,
  context: AdminAuditContext,
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, passwordHash: true, adminMembership: { select: { id: true } } },
    });
    if (!user) throw ApiError.notFound("User not found");
    requireExactEmail(confirmation, user.email);
    if (user.adminMembership) throw ApiError.conflict("This user already has administration access");
    if (!user.passwordHash) throw ApiError.badRequest("The user must configure password authentication before receiving administration access");

    const membership = await tx.adminMembership.create({
      data: { userId: user.id, role },
      select: { id: true, userId: true, role: true, status: true, mfaRequired: true, mfaEnrolledAt: true, createdAt: true },
    });
    await recordAdminAudit({
      actor,
      action: "ADMIN_ACCESS_GRANTED",
      targetType: "admin_membership",
      targetId: membership.id,
      newValue: { userId: user.id, email: user.email, role: membership.role, status: membership.status },
      context,
    }, tx);
    return membership;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function updateAdminAccess(
  actor: AdminAuditActor,
  userId: string,
  input: { role?: AdminRole; status?: AdminMembershipStatus; confirmation: string },
  context: AdminAuditContext,
) {
  if (userId === actor.userId) throw ApiError.conflict("Use another Super Admin account to change your own administration access");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, adminMembership: { select: { id: true, role: true, status: true, mfaRequired: true, mfaEnrolledAt: true } } },
    });
    if (!user) throw ApiError.notFound("User not found");
    requireExactEmail(input.confirmation, user.email);
    if (!user.adminMembership) throw ApiError.notFound("Administration membership not found");

    const nextRole = input.role ?? user.adminMembership.role;
    const nextStatus = input.status ?? user.adminMembership.status;
    if (nextRole === user.adminMembership.role && nextStatus === user.adminMembership.status) {
      throw ApiError.conflict("Administration access is already configured with those values");
    }
    if (user.adminMembership.role === "SUPER_ADMIN" && user.adminMembership.status === "ACTIVE" && (nextRole !== "SUPER_ADMIN" || nextStatus !== "ACTIVE")) {
      await requireAnotherActiveSuperAdmin(tx, user.adminMembership);
    }

    const updated = await tx.adminMembership.update({
      where: { id: user.adminMembership.id },
      data: { role: nextRole, status: nextStatus },
      select: { id: true, userId: true, role: true, status: true, mfaRequired: true, mfaEnrolledAt: true, createdAt: true },
    });
    const revoked = await revokeTargetAdminSessions(tx, user.id, "admin_access_changed");
    await recordAdminAudit({
      actor,
      action: "ADMIN_ACCESS_UPDATED",
      targetType: "admin_membership",
      targetId: updated.id,
      oldValue: { role: user.adminMembership.role, status: user.adminMembership.status },
      newValue: { role: updated.role, status: updated.status, revokedSessionCount: revoked.count },
      context,
    }, tx);
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function revokeAdminAccess(
  actor: AdminAuditActor,
  userId: string,
  confirmation: string,
  context: AdminAuditContext,
) {
  if (userId === actor.userId) throw ApiError.conflict("Use another Super Admin account to revoke your own administration access");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, adminMembership: { select: { id: true, role: true, status: true, mfaRequired: true } } },
    });
    if (!user) throw ApiError.notFound("User not found");
    requireExactEmail(confirmation, user.email);
    if (!user.adminMembership) throw ApiError.notFound("Administration membership not found");
    await requireAnotherActiveSuperAdmin(tx, user.adminMembership);

    const revoked = await revokeTargetAdminSessions(tx, user.id, "admin_access_revoked");
    await tx.adminMembership.delete({ where: { id: user.adminMembership.id } });
    await recordAdminAudit({
      actor,
      action: "ADMIN_ACCESS_REVOKED",
      targetType: "admin_membership",
      targetId: user.adminMembership.id,
      oldValue: { userId: user.id, email: user.email, role: user.adminMembership.role, status: user.adminMembership.status },
      newValue: { revoked: true, revokedSessionCount: revoked.count },
      context,
    }, tx);
    return { userId: user.id, revoked: true as const };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
