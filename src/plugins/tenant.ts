import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Plan } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    businessId?: string;
    /**
     * Resolved server-side from the trusted businessId, never from anything
     * the client sent — see resolvePlan below. Routes/services must treat
     * this as the sole source of truth for entitlement decisions.
     */
    plan?: Plan;
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
    });

    if (!membership) {
      throw ApiError.forbidden("User is not a member of any business");
    }

    request.businessId = membership.businessId;

    // Resolved once per request here, rather than re-queried by every
    // service that needs plan/entitlement information downstream.
    const subscription = await prisma.subscription.findUnique({
      where: { businessId: membership.businessId },
      select: { plan: true },
    });
    // Every business gets a Subscription row at creation time (registration
    // and POST /business) and the add_subscriptions migration backfilled
    // every pre-existing business — a missing row is not an expected state,
    // but defaulting to FREE here (rather than throwing) is the
    // least-privilege fallback if it somehow happens.
    request.plan = subscription?.plan ?? "FREE";
  });
});
