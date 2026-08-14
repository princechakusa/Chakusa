import type { FastifyInstance } from "fastify";
import { getSubscriptionStatus } from "./subscription.service.js";

/**
 * Product-state read contract for mobile — plan, subscription status,
 * feature entitlements, and authoritative resource usage/limits, all
 * derived server-side. request.businessId comes only from requireBusiness
 * (the authenticated user's trusted membership), never from anything the
 * client sends, so there is no businessId/plan/status query or body input
 * to accept here at all.
 */
export default async function subscriptionRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/status", async (request, reply) => {
    reply.send(await getSubscriptionStatus(request.businessId!));
  });
}
