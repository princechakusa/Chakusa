import type { FastifyInstance } from "fastify";
import { ApiError } from "../../lib/errors.js";
import { handleAppleNotification, handleGoogleNotification, type GoogleRtdnEnvelope } from "../../lib/billing/subscriptionReconciliation.js";
import { realAppleStoreClient, type AppleStoreClient } from "../../lib/billing/appleAppStoreClient.js";
import { realGooglePlayClient, type GooglePlayClient } from "../../lib/billing/googlePlayClient.js";
import { verifyGoogleRtdnAuthorization } from "./googleRtdnAuth.js";
import { defaultTwilioProvider } from "../../lib/messaging/twilioProvider.js";
import type { MessagingProvider } from "../../lib/messaging/messagingProvider.js";
import { prisma } from "../../lib/prisma.js";
import { defaultStripePaymentProvider, type StripePaymentProvider } from "../../lib/payments/stripeProvider.js";
import { applyStripeEvent } from "../payments/payments.service.js";
import { createHash } from "node:crypto";
import { recordDeliveryReceipt, recordInboundMessage } from "../../lib/messaging/messagingPlatform.js";
import { handleInboundAIMessage } from "../../lib/ai/agent/customerAgent.js";
import { captureUnexpectedError } from "../../lib/sentry.js";

export interface WebhookRoutesOptions {
  /** Test-only injection point — see subscription.routes.ts's SubscriptionRoutesOptions for the identical pattern. Defaults to the real store clients; never live in tests. */
  appleStoreClient?: AppleStoreClient;
  googlePlayClient?: GooglePlayClient;
  messagingProvider?: MessagingProvider;
  stripePaymentProvider?: StripePaymentProvider;
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
  const messagingProvider = options.messagingProvider ?? defaultTwilioProvider;
  const stripePaymentProvider = options.stripePaymentProvider ?? defaultStripePaymentProvider;

  fastify.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_request, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(String(body)))); } catch (error) { done(error as Error); }
  });

  const webhookContext = (request: { headers: Record<string, string | string[] | undefined>; protocol: string; hostname: string; url: string }) => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
    return { headers, url: `${request.protocol}://${request.hostname}${request.url}` };
  };

  fastify.post("/twilio/status", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (request, reply) => {
    const context = webhookContext(request);
    if (!messagingProvider.verifyWebhookSignature(request.body, context.headers, context.url)) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid webhook signature");
    const event = messagingProvider.parseDeliveryWebhook(request.body, context.headers);
    if (!event) throw ApiError.badRequest("Invalid delivery event");
    const eventId = createHash("sha256").update(`${event.providerMessageId}:${event.status}:${event.occurredAt.toISOString()}:${event.errorCode ?? ""}`).digest("hex");
    const recorded = await recordDeliveryReceipt({ provider: messagingProvider.id, providerEventId: eventId, providerMessageId: event.providerMessageId, status: event.status, occurredAt: event.occurredAt, errorCode: event.errorCode, payload: request.body });
    if (!recorded) {
      const status = event.status === "delivered" ? "delivered" : event.status === "undelivered" ? "undelivered" : event.status === "failed" ? "failed" : "sent";
      await prisma.message.updateMany({ where: { providerMessageId: event.providerMessageId }, data: { status, providerErrorCode: event.errorCode ?? null, deliveredAt: event.status === "delivered" ? event.occurredAt : null } });
    }
    reply.send({ received: true });
  });

  fastify.post("/twilio/inbound", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (request, reply) => {
    const context = webhookContext(request);
    if (!messagingProvider.verifyWebhookSignature(request.body, context.headers, context.url)) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid webhook signature");
    const event = messagingProvider.parseInboundWebhook(request.body, context.headers);
    if (!event) throw ApiError.badRequest("Invalid inbound event");
    const phone = event.from.replace(/^whatsapp:/, "");
    const customers = await prisma.customer.findMany({ where: { phoneE164: phone }, select: { id: true, businessId: true } });
    const providerMessageId = typeof (request.body as Record<string, unknown>)?.MessageSid === "string" ? String((request.body as Record<string, unknown>).MessageSid) : createHash("sha256").update(`${phone}:${event.receivedAt.toISOString()}:${event.body}`).digest("hex");
    // LOOP 4: after the inbound message is durably recorded, the AI Customer
    // Agent gets a turn for any business that has opted in. It is awaited so
    // an autonomous reply is enqueued before this webhook acks (the run is
    // idempotent on the inbound message id, so a Twilio retry replays
    // safely), but a failure never blocks the ack.
    for (const customer of customers) {
      const inbound = await recordInboundMessage({ businessId: customer.businessId, customerId: customer.id, from: phone, channel: event.channel, body: event.body, provider: messagingProvider.id, providerMessageId });
      try {
        await handleInboundAIMessage({ businessId: customer.businessId, conversationId: inbound.conversationId!, customerId: customer.id, providerMessageId, channel: event.channel, body: event.body });
      } catch (error) {
        captureUnexpectedError(error);
      }
    }
    if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(event.body.trim().toUpperCase())) {
      for (const { businessId } of customers) {
        const channel = event.channel === "whatsapp" ? "WHATSAPP" : "SMS";
        await prisma.customerOptOut.upsert({ where: { businessId_phone_channel: { businessId, phone, channel } }, create: { businessId, phone, channel, source: "provider_webhook" }, update: { source: "provider_webhook" } });
      }
    }
    reply.type("text/xml").send("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>");
  });

  fastify.post("/stripe", { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } }, async (request, reply) => {
    const signature = request.headers["stripe-signature"];
    if (typeof signature !== "string" || !request.rawBody) throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid Stripe webhook signature");
    let event;
    try { event = stripePaymentProvider.constructEvent(request.rawBody, signature); } catch { throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid Stripe webhook signature"); }
    await applyStripeEvent(event);
    reply.send({ received: true });
  });

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
