import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { getPlanLimits, withLimitCheck } from "../../lib/entitlements.js";
import type { BusinessRole, Plan } from "@prisma/client";
import type { ChangeMemberRoleInput, TransferOwnershipInput } from "./team.schemas.js";

/** Safe fields only — never authentication internals (passwordHash, sessions, identities). See the Business Phase 1 report's "member list endpoint" section. */
export async function listMembers(businessId: string) {
  const members = await prisma.businessMember.findMany({
    where: { businessId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      status: true,
      createdAt: true,
      user: { select: { id: true, fullName: true, email: true } },
    },
  });
  return members.map((member) => ({
    id: member.id,
    userId: member.user.id,
    name: member.user.fullName,
    email: member.user.email,
    role: member.role,
    status: member.status,
    joinedAt: member.createdAt,
  }));
}

async function getOwnedMember(businessId: string, id: string) {
  const member = await prisma.businessMember.findFirst({ where: { id, businessId } });
  if (!member) throw ApiError.notFound("Team member not found");
  return member;
}

/**
 * Owner-only (enforced by the route, not here — see team.routes.ts). Role
 * changes are deliberately narrow: OWNER may move a member between ADMIN
 * and STAFF, never touch OWNER (their own row, or anyone else's, is never
 * a valid target) — see the Business Phase 1 report's "role change
 * behavior" section for why ownership transfer is explicitly out of scope
 * for v1.
 */
export async function changeMemberRole(businessId: string, actorUserId: string, memberId: string, input: ChangeMemberRoleInput) {
  const member = await getOwnedMember(businessId, memberId);
  if (member.role === "OWNER") {
    throw ApiError.forbidden("Ownership cannot be changed");
  }

  const updated = await prisma.businessMember.update({ where: { id: memberId }, data: { role: input.role } });
  await recordActivity({
    businessId,
    actorId: actorUserId,
    eventType: "TEAM_MEMBER_ROLE_CHANGED",
    entityType: "business_member",
    entityId: memberId,
    metadata: { from: member.role, to: input.role },
  });
  return updated;
}

/**
 * Soft removal — sets status to SUSPENDED rather than deleting the row or
 * the underlying User account (see the Business Phase 1 report's "staff
 * removal behavior" section). Reuses the identical status value
 * tenant.ts's downgrade-sync logic already uses for "business lost Business
 * entitlement" — both mean the same thing to authorization (this member
 * cannot currently act in this business), and both are reversible via
 * reactivateMember below. The owner can never be removed.
 */
export async function removeMember(businessId: string, actorUserId: string, memberId: string) {
  const member = await getOwnedMember(businessId, memberId);
  if (member.role === "OWNER") {
    throw ApiError.forbidden("The business owner cannot be removed");
  }

  const claimed = await prisma.businessMember.updateMany({
    where: { id: memberId, businessId, status: "ACTIVE" },
    data: { status: "SUSPENDED" },
  });
  if (claimed.count > 0) {
    await recordActivity({ businessId, actorId: actorUserId, eventType: "TEAM_MEMBER_REMOVED", entityType: "business_member", entityId: memberId });
  }
  return prisma.businessMember.findFirstOrThrow({ where: { id: memberId, businessId } });
}

/**
 * Deliberate, seat-checked owner action — never automatic (see
 * tenant.ts's downgrade-sync doc comment for why bulk auto-reactivation on
 * re-upgrade was rejected: it would bypass whatever the current seat limit
 * actually allows). Reuses the identical Serializable-transaction seat
 * check as createInvitation/acceptTeamInvitation.
 */
export async function reactivateMember(businessId: string, plan: Plan, actorUserId: string, memberId: string) {
  await getOwnedMember(businessId, memberId);

  return withLimitCheck(async (tx) => {
    const member = await tx.businessMember.findFirstOrThrow({ where: { id: memberId, businessId } });
    if (member.role === "OWNER" || member.status === "ACTIVE") return member;

    const limit = getPlanLimits(plan).staffSeats;
    const current = await tx.businessMember.count({ where: { businessId, status: "ACTIVE" } });
    if (limit !== null && current >= limit) {
      throw ApiError.limitReached("staffSeats", "team seats", { limit, current, plan });
    }

    const updated = await tx.businessMember.update({ where: { id: memberId }, data: { status: "ACTIVE" } });
    await recordActivity(
      { businessId, actorId: actorUserId, eventType: "TEAM_MEMBER_JOINED", entityType: "business_member", entityId: memberId, metadata: { reactivated: true } },
      tx,
    );
    return updated;
  });
}

/**
 * Business Phase 1.2: the one authoritative seat-usage read, for mobile's
 * "X of N seats used" display. `current`'s definition is deliberately
 * copy-pasted-in-spirit (not literally shared code, but the exact same two
 * queries) from createInvitation's own seat check
 * (teamInvitations.service.ts) — ACTIVE members plus non-expired PENDING
 * invitations, since a pending invite optimistically reserves a seat the
 * moment it's sent. This function must never drift from that definition:
 * if createInvitation's seat check changes, this must change identically,
 * or mobile's seat display and the server's actual enforcement boundary
 * will silently disagree.
 *
 * Read-only — an expired PENDING invitation is simply excluded from
 * `pendingReservations` by the `expiresAt: { gt: now }` filter, the same
 * way createInvitation's own count already does. This does not durably
 * mark it EXPIRED (that write only happens lazily when the specific
 * invitation is actually resolved — see resolveTeamInvitation/
 * claimInvitationForNewUser); a summary read must not have that kind of
 * side effect.
 */
export async function getSeatSummary(businessId: string, plan: Plan) {
  const now = new Date();
  const [activeMembers, pendingReservations] = await Promise.all([
    prisma.businessMember.count({ where: { businessId, status: "ACTIVE" } }),
    prisma.teamInvitation.count({ where: { businessId, status: "PENDING", expiresAt: { gt: now } } }),
  ]);
  const current = activeMembers + pendingReservations;
  const limit = getPlanLimits(plan).staffSeats;
  const remaining = limit === null ? null : Math.max(limit - current, 0);
  return { activeMembers, pendingReservations, current, limit, remaining };
}

export async function transferOwnership(businessId: string, actorUserId: string, input: TransferOwnershipInput) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ownership:${businessId}`}))`;
    const business = await tx.business.findUnique({ where: { id: businessId }, select: { name: true, ownerId: true } });
    if (!business) throw ApiError.notFound("Business not found");
    if (business.ownerId !== actorUserId) throw ApiError.forbidden("Only the current business owner can transfer ownership");
    if (business.name.trim() !== input.businessName.trim()) throw ApiError.badRequest("Enter the exact business name to confirm ownership transfer");

    const target = await tx.businessMember.findFirst({ where: { id: input.memberId, businessId, status: "ACTIVE", role: { not: "OWNER" } } });
    if (!target) throw ApiError.notFound("Choose an active team member to become owner");
    const otherOwnedBusiness = await tx.business.findFirst({ where: { ownerId: target.userId, id: { not: businessId } }, select: { id: true } });
    if (otherOwnedBusiness) throw ApiError.conflict("This team member already owns another business");
    const currentOwner = await tx.businessMember.findFirst({ where: { businessId, userId: actorUserId, role: "OWNER" } });
    if (!currentOwner) throw ApiError.conflict("The current owner membership is unavailable");

    await tx.businessMember.update({ where: { id: currentOwner.id }, data: { role: "ADMIN", status: "ACTIVE" } });
    await tx.businessMember.update({ where: { id: target.id }, data: { role: "OWNER" } });
    await tx.business.update({ where: { id: businessId }, data: { ownerId: target.userId } });
    await recordActivity({ businessId, actorId: actorUserId, eventType: "TEAM_MEMBER_ROLE_CHANGED", entityType: "business_member", entityId: target.id, metadata: { ownershipTransferred: true, fromUserId: actorUserId, toUserId: target.userId } }, tx);
    return { businessId, previousOwnerUserId: actorUserId, ownerUserId: target.userId };
  }, { isolationLevel: "Serializable" });
}

export type { BusinessRole };
