import type { FastifyInstance } from "fastify";
import { ApiError } from "../../lib/errors.js";
import { handleAppleNotification, handleGoogleNotification, type GoogleRtdnEnvelope } from "../../lib/billing/subscriptionReconciliation.js";
import { realAppleStoreClient, type AppleStoreClient } from "../../lib/billing/appleAppStoreClient.js";
import { realGooglePlayClient, type GooglePlayClient } from "../../lib/billing/googlePlayClient.js";
import { verifyGoogleRtdnAuthorization } from "./googleRtdnAuth.js";

export interface WebhookRoutesOptions {
  /** Test-only injection point — see subscription.routes.ts's SubscriptionRoutesOptions for the identical pattern. Defaults to the real store clients; never live in tests. */
  appleStoreClient?: AppleStoreClient;
  googlePlayClient?: GooglePlayClient;
}

/**
 * Unauthenticated by design — no fastify.authenticate/requireBusiness hook,
 * the same shape as public.routes.ts's public review endpoints, but for a
 * different reason: these are provider-to-server callbacks, not
 * customer-facing pages. Each route authenticates itself in the way that
 * provider actually supports (Apple: verifying the signed payload's
 * certificate chain; Google: verifying Pub/Sub's OIDC bearer token — see
 * googleRtdnAuth.ts) rather than Chakusa's normal bearer-session auth,
 * which neither provider can produce.
 *
 * Rate limits here are deliberately much higher than any customer-facing
 * route and exist only as a DoS backstop — Apple/Google retry undelivered
 * notifications on their own schedule, and this must never be the reason a
 * legitimate retry gets throttled away (see the Phase report's "rate
 * limiting" section).
 *
 * RETRY SEMANTICS (Phase 1.1 hardening — read before changing either route):
 * handleAppleNotification/handleGoogleNotification return `"invalid"` only
 * for a payload that failed authentication/parsing and can never become
 * valid by being retried — that case is acknowledged with 200 below.
 * Neither route wraps the processing call in a try/catch: a transient
 * failure (database unreachable, this backend's own outbound call to
 * Apple's/Google's API failing) is left to throw and propagate to
 * errorHandler.ts's default 500 response, so Apple/Google's own retry
 * mechanism gets a chance to redeliver the notification later instead of
 * this backend silently acknowledging an event it never actually applied.
 */
export default async function webhookRoutes(fastify: FastifyInstance, options: WebhookRoutesOptions = {}) {
  const appleStoreClient = options.appleStoreClient ?? realAppleStoreClient;
  const googlePlayClient = options.googlePlayClient ?? realGooglePlayClient;

  fastify.post(
    "/apple/subscriptions",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = request.body as { signedPayload?: unknown } | undefined;
      if (!body || typeof body.signedPayload !== "string") {
        throw ApiError.badRequest("Missing signedPayload");
      }

      const outcome = await handleAppleNotification(body.signedPayload, appleStoreClient);
      if (outcome === "invalid") {
        request.log.warn("[webhooks] could not authenticate an Apple notification payload; acknowledging without action");
      }
      reply.status(200).send({ received: true });
    },
  );

  fastify.post(
    "/google/subscriptions",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (request, reply) => {
      await verifyGoogleRtdnAuthorization(request.headers.authorization);

      const envelope = request.body as GoogleRtdnEnvelope | undefined;
      if (!envelope?.message?.data || !envelope.message.messageId) {
        throw ApiError.badRequest("Missing Pub/Sub message envelope");
      }

      const outcome = await handleGoogleNotification(envelope, googlePlayClient);
      if (outcome === "invalid") {
        request.log.warn("[webhooks] could not parse a Google RTDN payload; acknowledging without action");
      }
      reply.status(200).send({ received: true });
    },
  );
}
