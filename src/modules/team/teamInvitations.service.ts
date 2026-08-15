import { Prisma, type BusinessRole, type Plan } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { normalizeEmail } from "../../lib/email.js";
import { config } from "../../lib/config.js";
import { generateOpaqueToken, parseOpaqueToken, tokenHashMatches } from "../../lib/authTokens.js";
import { assertUnderLimit, getPlanLimits, withLimitCheck } from "../../lib/entitlements.js";
import type { CreateInvitationInput } from "./team.schemas.js";

/**
 * Creates a PENDING invitation, checking seat capacity and duplicate-invite/
 * existing-member conditions inside a single Serializable transaction — the
 * same withLimitCheck pattern already used for lead/review-request/customer
 * limits (entitlements.ts), so two owners inviting simultaneously with one
 * seat left can only ever have one succeed (see the Business Phase 1
 * report's "concurrency" section). This is the invite-time checkpoint;
 * acceptInvitation below re-checks the same limit at accept time, since a
 * pending invite does not itself reserve a seat.
 *
 * Returns the raw token exactly once, the same guarantee
 * reviews.service.ts's generatePublicReviewLink already establishes for
 * public review tokens — only the hash is ever persisted.
 */
export async function createInvitation(businessId: string, plan: Plan, inviterUserId: string, input: CreateInvitationInput) {
  const normalizedEmail = normalizeEmail(input.email);

  return withLimitCheck(async (tx) => {
    const existingUser = await tx.user.findUnique({ where: { normalizedEmail } });
    if (existingUser) {
      const existingMembership = await tx.businessMember.findFirst({ where: { userId: existingUser.id } });
      if (existingMembership) {
        throw ApiError.conflict("This person already belongs to a Chakusa business");
      }
    }

    const existingPending = await tx.teamInvitation.findFirst({
      where: { businessId, invitedEmail: normalizedEmail, status: "PENDING" },
    });
    if (existingPending && existingPending.expiresAt > new Date()) {
      throw ApiError.conflict("An invitation is already pending for this email");
    }

    // Counts ACTIVE members AND non-expired PENDING invitations together —
    // an invitation optimistically reserves a seat the moment it's sent,
    // not only once accepted. This is what makes concurrent invites at the
    // seat boundary actually race-safe within this same Serializable
    // transaction (see the Business Phase 1 report's "concurrency"
    // section): two owners inviting simultaneously with one seat left can
    // only ever have one succeed, because the loser's own count() (once
    // Postgres serializes the two transactions) already reflects the
    // winner's just-created PENDING row. acceptTeamInvitation still
    // re-checks ACTIVE count alone at accept time as the final backstop,
    // since a seat reservation should not survive an invite silently
    // expiring forever.
    const limit = getPlanLimits(plan).staffSeats;
    const [activeCount, pendingCount] = await Promise.all([
      tx.businessMember.count({ where: { businessId, status: "ACTIVE" } }),
      tx.teamInvitation.count({ where: { businessId, status: "PENDING", expiresAt: { gt: new Date() } } }),
    ]);
    const current = activeCount + pendingCount;
    assertUnderLimit({ plan, resource: "staffSeats", limit, current });

    const { id: tokenId, raw, hash } = generateOpaqueToken();
    const expiresAt = new Date(Date.now() + config.TEAM_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invitation = await tx.teamInvitation.create({
      data: {
        businessId,
        invitedEmail: normalizedEmail,
        role: input.role,
        tokenId,
        tokenHash: hash,
        invitedByUserId: inviterUserId,
        expiresAt,
      },
    });

    await recordActivity(
      { businessId, actorId: inviterUserId, eventType: "TEAM_MEMBER_INVITED", entityType: "team_invitation", entityId: invitation.id },
      tx,
    );

    return { invitation, token: raw };
  });
}

/**
 * Derives display status from `expiresAt` without a background job — see
 * TeamInvitation's schema doc comment. Never mutates; callers that need to
 * durably record an expiry transition (acceptInvitation) do so themselves
 * via a claim-guard update.
 */
export function effectiveInvitationStatus(invitation: { status: string; expiresAt: Date }): string {
  if (invitation.status === "PENDING" && invitation.expiresAt <= new Date()) return "EXPIRED";
  return invitation.status;
}

export async function listInvitations(businessId: string) {
  const invitations = await prisma.teamInvitation.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    select: { id: true, invitedEmail: true, role: true, status: true, expiresAt: true, createdAt: true, acceptedAt: true, revokedAt: true },
  });
  return invitations.map((invitation) => ({ ...invitation, status: effectiveInvitationStatus(invitation) }));
}

async function getOwnedInvitation(businessId: string, id: string) {
  const invitation = await prisma.teamInvitation.findFirst({ where: { id, businessId } });
  if (!invitation) throw ApiError.notFound("Invitation not found");
  return invitation;
}

/**
 * Claim-guarded — the same atomic-updateMany-with-a-WHERE-guard pattern
 * used throughout this codebase — so revoking an invitation that was just
 * accepted (or already revoked) concurrently is a safe no-op, not a race.
 */
export async function revokeInvitation(businessId: string, id: string) {
  await getOwnedInvitation(businessId, id);
  const claimed = await prisma.teamInvitation.updateMany({
    where: { id, businessId, status: "PENDING" },
    data: { status: "REVOKED", revokedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw ApiError.conflict("This invitation can no longer be revoked");
  }
  return prisma.teamInvitation.findFirstOrThrow({ where: { id, businessId } });
}

export interface ResolvedInvitation {
  state: "open" | "accepted" | "expired" | "revoked";
  invitation: Prisma.TeamInvitationGetPayload<{ include: { business: true } }>;
}

/**
 * Public resolution — generic null for anything invalid (unknown token,
 * hash mismatch, malformed), the same "a client can never learn *why* a
 * token didn't resolve" contract publicReviews.service.ts's
 * resolvePublicReviewToken already establishes. An expired PENDING
 * invitation is durably recorded as EXPIRED here (a claim-guard update,
 * not a cron) the first time anyone actually looks at it.
 */
export async function resolveTeamInvitation(rawToken: string): Promise<ResolvedInvitation | null> {
  const tokenId = parseOpaqueToken(rawToken);
  if (!tokenId) return null;

  const invitation = await prisma.teamInvitation.findUnique({ where: { tokenId }, include: { business: true } });
  if (!invitation || !tokenHashMatches(rawToken, invitation.tokenHash)) return null;

  if (invitation.status === "PENDING" && invitation.expiresAt <= new Date()) {
    const claimed = await prisma.teamInvitation.updateMany({ where: { id: invitation.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    const fresh = claimed.count > 0 ? { ...invitation, status: "EXPIRED" as const } : await prisma.teamInvitation.findFirstOrThrow({ where: { id: invitation.id }, include: { business: true } });
    return { state: "expired", invitation: fresh };
  }
  if (invitation.status === "ACCEPTED") return { state: "accepted", invitation };
  if (invitation.status === "REVOKED") return { state: "revoked", invitation };
  if (invitation.status === "EXPIRED") return { state: "expired", invitation };
  return { state: "open", invitation };
}

export type AcceptInvitationOutcome =
  | { outcome: "accepted"; businessId: string }
  | { outcome: "not-found" }
  | { outcome: "expired" }
  | { outcome: "already-used" }
  | { outcome: "email-mismatch" }
  | { outcome: "already-member" }
  | { outcome: "seats-full" };

/**
 * Acceptance identity check (critical — see the Business Phase 1 report's
 * "invite security" section): the authenticated caller's own email must
 * match the invitation's invitedEmail exactly. A user authenticated as
 * email B can never accept an invitation addressed to email A, regardless
 * of whether they hold a valid token for it.
 *
 * Seat capacity is re-checked here (not just at invite creation) inside
 * the same Serializable transaction that creates the BusinessMember row —
 * a pending invitation never reserved a seat, so this is the real,
 * final enforcement point. See createInvitation's doc comment.
 */
export async function acceptTeamInvitation(rawToken: string, userId: string): Promise<AcceptInvitationOutcome> {
  const resolved = await resolveTeamInvitation(rawToken);
  if (!resolved) return { outcome: "not-found" };
  if (resolved.state === "expired") return { outcome: "expired" };
  if (resolved.state === "accepted" || resolved.state === "revoked") return { outcome: "already-used" };

  const { invitation } = resolved;

  // The JWT access token carries only userId/sessionId (see auth.ts) — the
  // caller's email is looked up here rather than trusted from anywhere
  // client-suppliable, which is exactly what makes this check meaningful.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { normalizedEmail: true } });
  if (!user || user.normalizedEmail !== invitation.invitedEmail) return { outcome: "email-mismatch" };

  return withLimitCheck(async (tx) => {
    const existingMembership = await tx.businessMember.findFirst({ where: { userId } });
    if (existingMembership) return { outcome: "already-member" as const };

    // Re-read plan freshly rather than trusting anything captured earlier
    // in this request — it lives on a related row, not the invitation.
    const subscription = await tx.subscription.findUnique({ where: { businessId: invitation.businessId }, select: { plan: true } });
    const plan = subscription?.plan ?? "FREE";
    const seatLimit = getPlanLimits(plan).staffSeats;
    const current = await tx.businessMember.count({ where: { businessId: invitation.businessId, status: "ACTIVE" } });
    if (seatLimit !== null && current >= seatLimit) {
      return { outcome: "seats-full" as const };
    }

    const claimed = await tx.teamInvitation.updateMany({ where: { id: invitation.id, status: "PENDING" }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
    if (claimed.count === 0) return { outcome: "already-used" as const };

    await tx.businessMember.create({ data: { businessId: invitation.businessId, userId, role: invitation.role, status: "ACTIVE" } });
    await recordActivity(
      { businessId: invitation.businessId, actorId: userId, eventType: "TEAM_MEMBER_JOINED", entityType: "business_member", entityId: userId },
      tx,
    );

    return { outcome: "accepted" as const, businessId: invitation.businessId };
  });
}

export type ClaimInvitationForNewUserResult =
  | { outcome: "claimed"; businessId: string; role: BusinessRole }
  | { outcome: "not-found" }
  | { outcome: "expired" }
  | { outcome: "already-used" }
  | { outcome: "email-mismatch" }
  | { outcome: "seats-full" };

/**
 * The invited-registration counterpart to acceptTeamInvitation, for the
 * "invitee has no Chakusa account yet" case (Business Phase 1.1 — see
 * publicTeamInvites.routes.ts's former "KNOWN V1 GAP" doc comment, now
 * closed). Unlike acceptTeamInvitation, this runs INSIDE the same
 * Serializable transaction that creates the new User row (see
 * auth.service.ts's registerUser) rather than against the ambient `prisma`
 * client — the invitation resolve-and-claim, seat check, and User/
 * BusinessMember creation must all commit or abort together, since there is
 * no already-existing account to safely leave in a half-joined state if a
 * later step in that same transaction fails.
 *
 * Identity is checked against the caller-supplied `normalizedEmail` directly
 * (there is no account to look up yet) rather than a session-derived email —
 * this is still safe because the email is the one the caller is about to
 * create their own account under (registerSchema's `email`, hashed into the
 * same transaction), not an unauthenticated claim about someone else's
 * identity.
 */
export async function claimInvitationForNewUser(
  tx: Prisma.TransactionClient,
  rawToken: string,
  normalizedEmail: string,
): Promise<ClaimInvitationForNewUserResult> {
  const tokenId = parseOpaqueToken(rawToken);
  if (!tokenId) return { outcome: "not-found" };

  const invitation = await tx.teamInvitation.findUnique({ where: { tokenId } });
  if (!invitation || !tokenHashMatches(rawToken, invitation.tokenHash)) return { outcome: "not-found" };

  if (invitation.status === "PENDING" && invitation.expiresAt <= new Date()) {
    // Deliberately the ambient `prisma` client, not `tx` — this call site
    // always ends by throwing (registration cannot proceed against an
    // expired invitation), which would roll back the enclosing transaction
    // and silently undo an EXPIRED write made via `tx`. Durably recording
    // the expiry is a fact about the invitation itself, independent of
    // whether this particular registration attempt succeeds, so it commits
    // on its own — the same reasoning resolveTeamInvitation already applies
    // for the read-side accept flow.
    await prisma.teamInvitation.updateMany({ where: { id: invitation.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    return { outcome: "expired" };
  }
  if (invitation.status !== "PENDING") return { outcome: "already-used" };

  // Same generic non-disclosure contract as acceptTeamInvitation's
  // email-mismatch branch — never confirm that an otherwise-valid token
  // exists to someone registering under the wrong email.
  if (invitation.invitedEmail !== normalizedEmail) return { outcome: "email-mismatch" };

  const subscription = await tx.subscription.findUnique({ where: { businessId: invitation.businessId }, select: { plan: true } });
  const plan = subscription?.plan ?? "FREE";
  const seatLimit = getPlanLimits(plan).staffSeats;
  const current = await tx.businessMember.count({ where: { businessId: invitation.businessId, status: "ACTIVE" } });
  if (seatLimit !== null && current >= seatLimit) return { outcome: "seats-full" };

  const claimed = await tx.teamInvitation.updateMany({ where: { id: invitation.id, status: "PENDING" }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
  if (claimed.count === 0) return { outcome: "already-used" };

  return { outcome: "claimed", businessId: invitation.businessId, role: invitation.role };
}
