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

export async function updateBusinessCohort(actor: AdminAuditActor, businessId: string, cohort: string | null, context: AdminAuditContext) {
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, betaCohort: true } });
  if (!business) throw ApiError.notFound("Business not found");
  const updated = await prisma.business.update({ where: { id: businessId }, data: { betaCohort: cohort || null }, select: { id: true, betaCohort: true } });
  await recordAdminAudit({ actor, action: "BUSINESS_BETA_COHORT_UPDATED", targetType: "business", targetId: businessId, oldValue: { cohort: business.betaCohort }, newValue: { cohort: updated.betaCohort }, context });
  return updated;
}

export async function updateBetaFeedback(actor: AdminAuditActor, id: string, status: "OPEN" | "IN_REVIEW" | "RESOLVED" | "CLOSED", internalNotes: string | null, context: AdminAuditContext) {
  const current = await prisma.betaFeedback.findUnique({ where: { id }, select: { id: true, status: true, internalNotes: true } });
  if (!current) throw ApiError.notFound("Feedback not found");
  const updated = await prisma.betaFeedback.update({ where: { id }, data: { status, internalNotes }, select: { id: true, status: true, internalNotes: true, updatedAt: true } });
  await recordAdminAudit({ actor, action: "BETA_FEEDBACK_UPDATED", targetType: "beta_feedback", targetId: id, oldValue: { status: current.status, internalNotes: current.internalNotes }, newValue: { status: updated.status, internalNotes: updated.internalNotes }, context });
  return updated;
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

export async function updateUserAccountStatus(actor: AdminAuditActor, userId: string, status: "ACTIVE" | "DISABLED", confirmation: string, context: AdminAuditContext) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true, accountStatus: true } });
    if (!user) throw ApiError.notFound("User not found");
    if (confirmation.toLowerCase() !== user.email.toLowerCase()) throw ApiError.badRequest("Enter the exact user email to confirm account status change");
    if (user.accountStatus === status) throw ApiError.conflict(`User account is already ${status.toLowerCase()}`);
    const updated = await tx.user.update({ where: { id: user.id }, data: { accountStatus: status }, select: { id: true, email: true, accountStatus: true } });
    const revoked = status === "DISABLED" ? await revokeAllSessions(user.id, "admin_account_disabled", tx) : { count: 0 };
    await recordAdminAudit({ actor, action: status === "DISABLED" ? "USER_DISABLED" : "USER_REACTIVATED", targetType: "user", targetId: user.id, oldValue: { accountStatus: user.accountStatus }, newValue: { accountStatus: status, revokedSessionCount: revoked.count }, context }, tx);
    return { ...updated, revokedSessionCount: revoked.count };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function retryAutomationRun(actor: AdminAuditActor, runId: string, context: AdminAuditContext) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.automationRun.findUnique({ where: { id: runId }, select: { id: true, status: true, scheduledFor: true, attemptCount: true, business: { select: { id: true, platformStatus: true } } } });
    if (!run) throw ApiError.notFound("Automation run not found");
    if (run.status !== "FAILED") throw ApiError.conflict("Only failed automation runs can be retried");
    if (run.business.platformStatus !== "ACTIVE") throw ApiError.conflict("The business must be active before retrying automation");
    const updated = await tx.automationRun.update({ where: { id: run.id }, data: { status: "PENDING", scheduledFor: new Date(), startedAt: null, completedAt: null, cancelledAt: null, leaseExpiresAt: null, errorMessage: null }, select: { id: true, status: true, scheduledFor: true, attemptCount: true } });
    await recordAdminAudit({ actor, action: "AUTOMATION_RUN_RETRIED", targetType: "automation_run", targetId: run.id, oldValue: { status: run.status, scheduledFor: run.scheduledFor, attemptCount: run.attemptCount }, newValue: { status: updated.status, scheduledFor: updated.scheduledFor, attemptCount: updated.attemptCount }, context }, tx);
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

const PLATFORM_SETTING_DEFAULTS = [
  { key: "maintenance_mode", enabled: false, description: "Gate platform maintenance mode. Enforced by the deployment layer when enabled." },
  { key: "automation_enabled", enabled: true, description: "Allow automation workers to process new runs." },
  { key: "communications_enabled", enabled: true, description: "Allow outbound communication providers to send." },
  { key: "ai_enabled", enabled: true, description: "Allow AI-assisted features to operate." },
  { key: "messaging_enabled", enabled: true, description: "Allow messaging features to operate." },
  { key: "providers_enabled", enabled: true, description: "Allow configured third-party providers to operate." },
  { key: "conversations_enabled", enabled: true, description: "Allow conversation features to operate." },
  { key: "support_read_only_impersonation", enabled: true, description: "Allow support agents to open audited read-only account context." },
] as const;

export async function listAdminPlatformSettings() {
  for (const setting of PLATFORM_SETTING_DEFAULTS) await prisma.platformSetting.upsert({ where: { key: setting.key }, create: { key: setting.key, value: setting.enabled, description: setting.description }, update: {} });
  return prisma.platformSetting.findMany({ where: { key: { in: PLATFORM_SETTING_DEFAULTS.map((setting) => setting.key) } }, orderBy: { key: "asc" }, select: { key: true, value: true, description: true, updatedAt: true } });
}

export async function updateAdminPlatformSetting(actor: AdminAuditActor, key: (typeof PLATFORM_SETTING_DEFAULTS)[number]["key"], enabled: boolean, context: AdminAuditContext) {
  const current = await prisma.platformSetting.findUnique({ where: { key } });
  if (!current) throw ApiError.notFound("Platform setting not found");
  const updated = await prisma.platformSetting.update({ where: { key }, data: { value: enabled }, select: { key: true, value: true, description: true, updatedAt: true } });
  await recordAdminAudit({ actor, action: "PLATFORM_SETTING_UPDATED", targetType: "platform_setting", targetId: key, oldValue: { value: current.value }, newValue: { value: enabled }, context });
  return updated;
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
