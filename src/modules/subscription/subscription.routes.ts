import type { FastifyInstance } from "fastify";
import { getSubscriptionStatus, verifySubscriptionWithApple, verifySubscriptionWithGoogle } from "./subscription.service.js";
import { verifyAppleSubscriptionSchema, verifyGoogleSubscriptionSchema } from "./subscription.schemas.js";
import { requireOwner } from "../../lib/authorization.js";
import type { AppleStoreClient } from "../../lib/billing/appleAppStoreClient.js";
import type { GooglePlayClient } from "../../lib/billing/googlePlayClient.js";

export interface SubscriptionRoutesOptions {
  /** Test-only injection point — see auth.routes.ts's googleTokenVerifier/appleTokenVerifier for the identical pattern. Defaults to the real store clients; never live in tests. */
  appleStoreClient?: AppleStoreClient;
  googlePlayClient?: GooglePlayClient;
}

/**
 * Product-state read contract for mobile — plan, subscription status,
 * feature entitlements, and authoritative resource usage/limits, all
 * derived server-side. request.businessId comes only from requireBusiness
 * (the authenticated user's trusted membership), never from anything the
 * client sends, so there is no businessId/plan/status query or body input
 * to accept here at all.
 *
 * The two verify routes below are the ONLY way a Subscription can ever move
 * toward Plan.PRO — businessId is always request.businessId (trusted tenant
 * context), never anything from the request body, and the body itself
 * carries only a transaction/purchase identifier that gets independently
 * re-verified against Apple/Google before anything is written. A rejected
 * or not-yet-entitled transaction/purchase surfaces as a 400, never a
 * silent no-op that could be mistaken for success.
 *
 * Business Phase 1 audit finding (see the Phase 1 report's "billing
 * authorization" section): before team membership existed, "every member"
 * meant "the sole owner," so this was never actually reachable by a
 * non-owner. Now that ADMIN/STAFF members exist, both verify routes are
 * explicitly owner-only — only OWNER may initiate purchase verification or
 * change this business's billing state, matching PRO's existing single-
 * owner behavior going forward for BUSINESS too.
 */
export default async function subscriptionRoutes(fastify: FastifyInstance, options: SubscriptionRoutesOptions = {}) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/status", async (request, reply) => {
    reply.send(await getSubscriptionStatus(request.businessId!));
  });

  fastify.post(
    "/apple/verify",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      requireOwner(request);
      const input = verifyAppleSubscriptionSchema.parse(request.body);
      await verifySubscriptionWithApple(request.businessId!, input.transactionId, options.appleStoreClient);
      reply.send(await getSubscriptionStatus(request.businessId!));
    },
  );

  fastify.post(
    "/google/verify",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      requireOwner(request);
      const input = verifyGoogleSubscriptionSchema.parse(request.body);
      await verifySubscriptionWithGoogle(request.businessId!, input.purchaseToken, options.googlePlayClient);
      reply.send(await getSubscriptionStatus(request.businessId!));
    },
  );
}
