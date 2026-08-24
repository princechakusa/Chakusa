/**
 * Provider-agnostic messaging contract — the future automation engine's
 * only dependency on "how a message actually gets sent." Modeled directly
 * on src/lib/push/pushProvider.ts: business logic depends only on this
 * interface, and a concrete implementation (Twilio, later a regional
 * provider) is the only place that knows about a specific vendor's HTTP
 * API, auth scheme, or error codes.
 *
 * Phase 1 note: this file defines the contract only. No implementation of
 * this interface exists yet — no Twilio, no network calls, nothing that
 * sends a real message. It exists now so later phases (the automation
 * engine, the Twilio adapter) are built against a settled shape rather
 * than inventing it under implementation pressure.
 */

export type MessagingChannel = "sms" | "whatsapp";

export interface OutboundMessage {
  /** E.164 recipient address. */
  to: string;
  /**
   * Sender id/number. Optional at the contract level — provider selection
   * and sender routing (which number/sender id a given send goes out from)
   * is a future concern of the automation engine, not of this interface.
   */
  from?: string;
  channel: MessagingChannel;
  body: string;
  /**
   * ISO 3166-1 alpha-2 of the recipient's country. Present on every
   * message (not inferred by the provider) because provider/sender
   * selection and compliance handling are country-driven decisions that
   * belong to the caller, not something a provider adapter should guess
   * from the phone number.
   */
  countryCode: string;
  /**
   * Caller-assigned, stable per logical send attempt (e.g. an
   * AutomationRun id in a future phase). Lets a provider adapter — or a
   * future retry layer — recognize "this is the same send being retried"
   * rather than dispatching a duplicate message.
   */
  idempotencyKey: string;
}

export interface SendResult {
  /** True if the provider accepted the message for delivery. */
  accepted: boolean;
  /** The provider's own identifier for this message, when accepted. */
  providerMessageId?: string;
  /** Provider-reported error code, for logging/debugging. */
  errorCode?: string;
  /**
   * True for errors that will never succeed on retry — invalid number,
   * permanently opted out, blocked recipient. False for transient errors
   * (rate limit, provider outage) a future retry policy may reattempt.
   * Mirrors PushSendResult.invalidToken in src/lib/push/pushProvider.ts,
   * which draws the same accepted/permanent-vs-transient distinction for
   * push tokens.
   */
  permanentFailure: boolean;
}

/** Normalized delivery-status vocabulary every provider adapter maps its own onto. */
export type DeliveryStatus = "queued" | "sent" | "delivered" | "undelivered" | "failed";

/** A single delivery-status update, already normalized out of a provider's webhook payload. */
export interface DeliveryEvent {
  /** Correlates back to SendResult.providerMessageId from the original send. */
  providerMessageId: string;
  status: DeliveryStatus;
  errorCode?: string;
  occurredAt: Date;
}

/** A normalized inbound message (customer reply, STOP keyword, etc.), out of a provider's webhook payload. */
export interface InboundEvent {
  /** Correlates to an earlier outbound send's providerMessageId, when the provider reports it (e.g. a threaded reply). */
  providerMessageId?: string;
  /** E.164 sender — the customer. */
  from: string;
  /** E.164 recipient — the business's sending number/sender id. */
  to: string;
  body: string;
  channel: MessagingChannel;
  receivedAt: Date;
}

export interface MessagingProvider {
  /** Stable identifier for this provider, e.g. "twilio". */
  id: string;

  /** Whether this provider can send on the given channel at all. */
  supportsChannel(channel: MessagingChannel): boolean;

  send(message: OutboundMessage): Promise<SendResult>;

  /** Returns null for a payload this provider doesn't recognize as a delivery-status webhook. */
  parseDeliveryWebhook(payload: unknown, headers: Headers): DeliveryEvent | null;

  /** Returns null for a payload this provider doesn't recognize as an inbound-message webhook. */
  parseInboundWebhook(payload: unknown, headers: Headers): InboundEvent | null;

  /** Verifies a webhook request genuinely came from this provider before any payload is trusted. */
  verifyWebhookSignature(payload: unknown, headers: Headers, url?: string): boolean;
}
