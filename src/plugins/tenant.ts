import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { BusinessRole, Plan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";
import { isEntitled } from "../lib/entitlements.js";

declare module "fastify" {
  interface FastifyRequest {
    businessId?: string;
    /**
     * Resolved server-side from the trusted businessId, never from anything
     * the client sent — see requireBusiness below. Routes/services must
     * treat this as the sole source of truth for entitlement decisions.
     *
     * `plan` alone is NOT sufficient for status-sensitive features
     * (AUTOMATION, OUTBOUND_MESSAGING, TEAM_MANAGEMENT) — see
     * entitlements.ts's STATUS_SENSITIVE_FEATURES. Always pass
     * `request.status` alongside `request.plan` to
     * assertFeatureAvailable/hasFeature for those features; the plan-only
     * overload throws if called with one of them.
     */
    plan?: Plan;
    status?: SubscriptionStatus;
    /**
     * The caller's own BusinessRole within request.businessId — resolved
     * here, never from anything the client sent. See
     * src/lib/authorization.ts for the centralized helpers that read this.
     */
    role?: BusinessRole;
  }
  interface FastifyInstance {
    requireBusiness: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Resolves the caller's business from their membership rather than trusting
 * any business_id supplied by the client. MVP assumes one business per user;
 * business_members still models multi-membership for future support.
 */
export default fp(async function tenantPlugin(fastify: FastifyInstance) {
  fastify.decorate("requireBusiness", async function (request: FastifyRequest) {
    const userId = request.user?.userId;
    if (!userId) {
      throw ApiError.unauthorized();
    }

    const membership = await prisma.businessMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: { business: { select: { platformStatus: true } } },
    });

    if (!membership) {
      throw ApiError.forbidden("User is not a member of any business");
    }

    request.businessId = membership.businessId;
    if (membership.business.platformStatus !== "ACTIVE") {
      throw ApiError.forbidden("This business is currently suspended by Chakusa administration");
    }

    // Resolved once per request here, rather than re-queried by every
    // service that needs plan/entitlement information downstream.
    const subscription = await prisma.subscription.findUnique({
      where: { businessId: membership.businessId },
      select: { plan: true, status: true },
    });
    // Every business gets a Subscription row at creation time (registration
    // and POST /business) and the add_subscriptions migration backfilled
    // every pre-existing business — a missing row is not an expected state,
    // but defaulting to FREE/ACTIVE here (rather than throwing) is the
    // least-privilege fallback if it somehow happens: FREE grants no Pro
    // feature regardless of status, so this can never over-grant.
    const plan = subscription?.plan ?? "FREE";
    const status = subscription?.status ?? "ACTIVE";
    request.plan = plan;
    request.status = status;

    // Business v1 downgrade safety (see the Business Phase 1 report's
    // "downgrade behavior" section): if this business no longer holds
    // TEAM_MANAGEMENT entitlement, every non-owner ACTIVE member is
    // suspended — access-only, never destructive (rows, and everything
    // they're linked to, are untouched). This is applied opportunistically
    // here, on the first request from *anyone* in the business after
    // entitlement is lost, rather than hooked into billing reconciliation
    // (subscriptionReconciliation.ts stays untouched) — the guard below
    // (`!isEntitled(...)`) makes this a no-op query for the overwhelming
    // common case (an entitled business, or one that never had non-owner
    // members), and the updateMany itself is idempotent: once every member
    // is already SUSPENDED, it matches zero rows on every subsequent call.
    //
    // Persisting suspension (rather than only gating access live) is what
    // makes seat limits meaningful on re-upgrade: a member who was ACTIVE
    // and simply never made a request during a downgrade window must not
    // silently regain access the instant entitlement returns, bypassing
    // whatever the new seat count allows — reactivation is a deliberate,
    // seat-checked owner action (see teamMembers.service.ts's
    // reactivateMember), not automatic.
    if (!isEntitled(plan, status, "TEAM_MANAGEMENT")) {
      await prisma.businessMember.updateMany({
        where: { businessId: membership.businessId, role: { not: "OWNER" }, status: "ACTIVE" },
        data: { status: "SUSPENDED" },
      });
    }

    // A non-owner caller is rejected if EITHER the whole business just lost
    // TEAM_MANAGEMENT entitlement (handled above) OR this specific member
    // was individually suspended by the owner (teamMembers.service.ts's
    // removeMember reuses this same status field for "removed" — see its
    // doc comment) — these are two different reasons to be locked out, and
    // an otherwise-fully-entitled Business must still honor an owner's
    // explicit removal of one person. `membership.status` here is the
    // pre-updateMany snapshot for THIS row; if the block above just
    // suspended it (the whole-business case), that's still correctly
    // reflected by re-deriving from the same `!isEntitled` condition rather
    // than re-reading the row.
    if (membership.role !== "OWNER" && (membership.status === "SUSPENDED" || !isEntitled(plan, status, "TEAM_MANAGEMENT"))) {
      throw ApiError.forbidden("Your access to this business is currently suspended");
    }
    request.role = membership.role;
  });
});
