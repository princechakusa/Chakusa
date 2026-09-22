import twilio from "twilio";
import { config } from "../config.js";
import type {
  MessagingProvider,
  MessagingChannel,
  OutboundMessage,
  SendResult,
  DeliveryEvent,
  InboundEvent,
} from "./messagingProvider.js";

/**
 * The minimal slice of the Twilio SDK's REST client this adapter actually
 * uses — injectable so tests can exercise the real send()/error-mapping
 * logic below against a fake client (no network call, no real credentials)
 * instead of only ever testing through a fully-fake MessagingProvider. The
 * real `twilio(accountSid, authToken)` client satisfies this structurally;
 * no cast is needed to pass it as the constructor's `client` argument.
 */
export interface TwilioRestClient {
  messages: {
    create(options: {
      to: string;
      body: string;
      from?: string;
      messagingServiceSid?: string;
      statusCallback?: string;
    }): Promise<{ sid: string; status: string }>;
  };
}

/**
 * Which sender to send from — a single number or a Messaging Service SID
 * (Twilio's sender-pool concept). Injectable for the same reason `client`
 * is: production defaults to reading it from config.ts, tests pass their
 * own so adapter behavior never depends on ambient environment state.
 */
export interface TwilioSenderConfig {
  fromNumber?: string;
  whatsappFrom?: string;
  messagingServiceSid?: string;
}

/**
 * Deliberately small and explicit — not a general Twilio error-code
 * reference. Each entry is a documented, non-retryable failure: the exact
 * same request would fail again identically. Anything not in this set
 * (including error codes not yet seen) is treated as transient, since a
 * future retry policy giving up on an error it doesn't recognize is worse
 * than it harmlessly retrying something that turns out to be permanent.
 * See https://www.twilio.com/docs/api/errors for Twilio's full reference.
 */
const PERMANENT_TWILIO_ERROR_CODES = new Set<number>([
  21211, // Invalid 'To' Phone Number
  21214, // 'To' phone number not verified (trial account restriction)
  21608, // 'From' phone number is not SMS-capable
  21610, // Recipient has opted out (Twilio's own STOP list / carrier filtering)
  21614, // 'To' number is not a valid mobile number
  21617, // Message body exceeds the maximum size Twilio accepts
]);

function classifyTwilioError(error: unknown): { errorCode?: string; permanentFailure: boolean } {
  if (error instanceof twilio.RestException) {
    const code = error.code;
    if (code !== undefined && PERMANENT_TWILIO_ERROR_CODES.has(code)) {
      return { errorCode: String(code), permanentFailure: true };
    }
    // Authentication/configuration errors (bad Account SID, bad auth
    // token) — retrying the identical request will fail again identically
    // until an operator fixes configuration, so these are permanent even
    // though the specific Twilio error code isn't in the list above.
    if (error.status === 401 || error.status === 403) {
      return { errorCode: code !== undefined ? String(code) : "AUTHENTICATION_ERROR", permanentFailure: true };
    }
    return { errorCode: code !== undefined ? String(code) : undefined, permanentFailure: false };
  }
  return { errorCode: "UNKNOWN_ERROR", permanentFailure: false };
}

/**
 * Twilio implementation of MessagingProvider. This is the only file in
 * Chakusa allowed to import the Twilio SDK or know anything about its
 * request/response/error shapes — everything it returns to a caller is
 * already normalized into the provider-neutral contract from
 * messagingProvider.ts.
 */
export class TwilioMessagingProvider implements MessagingProvider {
  readonly id = "twilio";
  private client: TwilioRestClient;
  private sender: TwilioSenderConfig;
  private authToken: string | undefined;

  constructor(client?: TwilioRestClient, sender?: TwilioSenderConfig, authToken?: string) {
    this.authToken = authToken ?? config.TWILIO_AUTH_TOKEN;
    this.client = client ?? twilio(config.TWILIO_ACCOUNT_SID, this.authToken);
    this.sender = sender ?? { fromNumber: config.TWILIO_FROM_NUMBER, whatsappFrom: config.TWILIO_WHATSAPP_FROM, messagingServiceSid: config.TWILIO_MESSAGING_SERVICE_SID };
  }

  /**
   * Rebuilds this provider's credentials in place from admin-set platform
   * provider secrets (src/lib/platformProviderSecrets.ts), each falling
   * back to its env var when not set in the database. Called once at boot,
   * after the secrets store has loaded — never mid-request. Reassigns the
   * instance's own fields rather than creating a new object, so the single
   * `defaultTwilioProvider` export (and anything already holding a
   * reference to it) keeps working unchanged.
   */
  applyOverrides(overrides: {
    accountSid?: string;
    authToken?: string;
    fromNumber?: string;
    whatsappFrom?: string;
    messagingServiceSid?: string;
  }): void {
    const accountSid = overrides.accountSid ?? config.TWILIO_ACCOUNT_SID;
    this.authToken = overrides.authToken ?? config.TWILIO_AUTH_TOKEN;
    this.client = twilio(accountSid, this.authToken);
    this.sender = {
      fromNumber: overrides.fromNumber ?? config.TWILIO_FROM_NUMBER,
      whatsappFrom: overrides.whatsappFrom ?? config.TWILIO_WHATSAPP_FROM,
      messagingServiceSid: overrides.messagingServiceSid ?? config.TWILIO_MESSAGING_SERVICE_SID,
    };
  }

  supportsChannel(channel: MessagingChannel): boolean {
    // WhatsApp is fully implemented (see send()/parseInboundWebhook() below)
    // — it's only "unsupported" at runtime until a WhatsApp sender number is
    // configured (TWILIO_WHATSAPP_FROM, or the equivalent admin-set
    // platform provider secret).
    return channel === "sms" ? Boolean(this.sender.fromNumber || this.sender.messagingServiceSid) : Boolean(this.sender.whatsappFrom);
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.sender.fromNumber && !this.sender.whatsappFrom && !this.sender.messagingServiceSid) {
      // Configuration error, never reaches Twilio at all — retrying the
      // same request cannot succeed without an operator fixing config.
      return { accepted: false, errorCode: "PROVIDER_NOT_CONFIGURED", permanentFailure: true };
    }

    if (!this.supportsChannel(message.channel)) {
      return { accepted: false, errorCode: "UNSUPPORTED_CHANNEL", permanentFailure: true };
    }

    try {
      const result = await this.client.messages.create({
        to: message.channel === "whatsapp" && !message.to.startsWith("whatsapp:") ? `whatsapp:${message.to}` : message.to,
        body: message.body,
        ...(message.channel === "whatsapp"
          ? { from: this.sender.whatsappFrom }
          : this.sender.messagingServiceSid
          ? { messagingServiceSid: this.sender.messagingServiceSid }
          : { from: this.sender.fromNumber }),
        ...(config.TWILIO_STATUS_CALLBACK_URL ? { statusCallback: config.TWILIO_STATUS_CALLBACK_URL } : {}),
      });

      return { accepted: true, providerMessageId: result.sid, permanentFailure: false };
    } catch (error) {
      return { accepted: false, ...classifyTwilioError(error) };
    }
  }

  parseDeliveryWebhook(payload: unknown): DeliveryEvent | null {
    if (!payload || typeof payload !== "object") return null;
    const body = payload as Record<string, unknown>;
    const providerMessageId = typeof body.MessageSid === "string" ? body.MessageSid : null;
    const rawStatus = typeof body.MessageStatus === "string" ? body.MessageStatus.toLowerCase() : null;
    if (!providerMessageId || !rawStatus) return null;
    const statuses: Record<string, DeliveryEvent["status"]> = { accepted: "queued", queued: "queued", sending: "sent", sent: "sent", delivered: "delivered", undelivered: "undelivered", failed: "failed" };
    const status = statuses[rawStatus];
    if (!status) return null;
    return { providerMessageId, status, errorCode: typeof body.ErrorCode === "string" && body.ErrorCode ? body.ErrorCode : undefined, occurredAt: new Date() };
  }

  parseInboundWebhook(payload: unknown): InboundEvent | null {
    if (!payload || typeof payload !== "object") return null;
    const body = payload as Record<string, unknown>;
    if (typeof body.From !== "string" || typeof body.To !== "string" || typeof body.Body !== "string") return null;
    return { providerMessageId: typeof body.OriginalRepliedMessageSid === "string" ? body.OriginalRepliedMessageSid : undefined, from: body.From, to: body.To, body: body.Body, channel: body.From.startsWith("whatsapp:") ? "whatsapp" : "sms", receivedAt: new Date() };
  }

  verifyWebhookSignature(payload: unknown, headers: Headers, url?: string): boolean {
    if (!url || !payload || typeof payload !== "object" || !this.authToken) return false;
    const signature = headers.get("x-twilio-signature");
    if (!signature) return false;
    const params = Object.fromEntries(Object.entries(payload as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    return twilio.validateRequest(this.authToken, signature, url, params);
  }
}

export const defaultTwilioProvider = new TwilioMessagingProvider();
