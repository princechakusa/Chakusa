import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { registerMessagingProvider } from "./providerRegistry.js";
import type {
  MessagingProvider,
  MessagingChannel,
  OutboundMessage,
  SendResult,
  DeliveryEvent,
  InboundEvent,
} from "./messagingProvider.js";

/**
 * Meta WhatsApp Cloud API, called directly with no reseller in between. This
 * is the only file that knows Graph API request/response/webhook shapes;
 * everything it returns is already normalised into messagingProvider.ts.
 *
 * WhatsApp only. A business can send free-form text inside the customer's
 * 24-hour window; outside it Meta rejects anything but an approved template,
 * which callers pass as `message.template` (`contentSid` carries the Meta
 * template name here, and `variables` "1".."n" are its ordered body params).
 */

export type MetaFetch = (url: string, init: { method: "POST"; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface MetaWhatsAppSettings {
  accessToken?: string;
  phoneNumberId?: string;
  appSecret?: string;
  apiVersion: string;
  templateLanguage: string;
}

// Documented, non-retryable Graph/WhatsApp failures: the identical request
// would fail again. Anything unknown is treated as transient.
const PERMANENT_META_ERROR_CODES = new Set<number>([
  131026, // Message undeliverable (not on WhatsApp / blocked / old version)
  131030, // Recipient not in allowed list (test number)
  131047, // Re-engagement: outside the 24-hour window and not a template
  131051, // Unsupported message type
  131052, // Media download error
  132000, // Template parameter count mismatch
  132001, // Template does not exist
  132005, // Translated text too long
  132007, // Template format character policy violated
  132012, // Template parameter format mismatch
  132015, // Template paused
  132016, // Template disabled
  133010, // Phone number not registered
  100, // Invalid parameter
  190, // Access token invalid or expired
]);

function toMetaRecipient(to: string): string {
  return to.replace(/^whatsapp:/, "").replace(/^\+/, "");
}

export class MetaWhatsAppProvider implements MessagingProvider {
  readonly id = "meta_whatsapp";
  private settings: MetaWhatsAppSettings;
  private fetchImpl: MetaFetch;

  constructor(settings?: Partial<MetaWhatsAppSettings>, fetchImpl?: MetaFetch) {
    this.settings = {
      accessToken: config.META_WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: config.META_WHATSAPP_PHONE_NUMBER_ID,
      appSecret: config.META_WHATSAPP_APP_SECRET,
      apiVersion: config.META_GRAPH_API_VERSION,
      templateLanguage: config.META_WHATSAPP_TEMPLATE_LANGUAGE,
      ...settings,
    };
    this.fetchImpl = fetchImpl ?? ((url, init) => fetch(url, init));
  }

  /** Credentials set from admin platform provider secrets, falling back to env. Called once at boot. */
  applyOverrides(overrides: Partial<Pick<MetaWhatsAppSettings, "accessToken" | "phoneNumberId" | "appSecret">>): void {
    this.settings = {
      ...this.settings,
      accessToken: overrides.accessToken ?? config.META_WHATSAPP_ACCESS_TOKEN,
      phoneNumberId: overrides.phoneNumberId ?? config.META_WHATSAPP_PHONE_NUMBER_ID,
      appSecret: overrides.appSecret ?? config.META_WHATSAPP_APP_SECRET,
    };
  }

  /** True once credentials exist; the router only uses this provider when so. */
  isConfigured(): boolean {
    return Boolean(this.settings.accessToken && this.settings.phoneNumberId);
  }

  supportsChannel(channel: MessagingChannel): boolean {
    return channel === "whatsapp" && this.isConfigured();
  }

  async send(message: OutboundMessage): Promise<SendResult> {
    if (!this.isConfigured()) return { accepted: false, errorCode: "PROVIDER_NOT_CONFIGURED", permanentFailure: true };
    if (message.channel !== "whatsapp") return { accepted: false, errorCode: "UNSUPPORTED_CHANNEL", permanentFailure: true };

    const to = toMetaRecipient(message.to);
    const payload = message.template
      ? {
          messaging_product: "whatsapp",
          to,
          type: "template",
          template: {
            name: message.template.contentSid,
            language: { code: this.settings.templateLanguage },
            components: [
              {
                type: "body",
                parameters: Object.entries(message.template.variables)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([, text]) => ({ type: "text", text })),
              },
            ],
          },
        }
      : { messaging_product: "whatsapp", to, type: "text", text: { preview_url: false, body: message.body } };

    try {
      const response = await this.fetchImpl(`https://graph.facebook.com/${this.settings.apiVersion}/${this.settings.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.settings.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => ({}))) as { messages?: Array<{ id?: string }>; error?: { code?: number } };
      if (response.ok) {
        const id = body.messages?.[0]?.id;
        return id ? { accepted: true, providerMessageId: id, permanentFailure: false } : { accepted: false, errorCode: "NO_MESSAGE_ID", permanentFailure: false };
      }
      const code = body.error?.code;
      const permanent = (code !== undefined && PERMANENT_META_ERROR_CODES.has(code)) || response.status === 401 || response.status === 403;
      return { accepted: false, errorCode: code !== undefined ? String(code) : `HTTP_${response.status}`, permanentFailure: permanent };
    } catch {
      return { accepted: false, errorCode: "NETWORK_ERROR", permanentFailure: false };
    }
  }

  /** Meta batches statuses into one webhook; this returns the first, parseDeliveryWebhooks returns all. */
  parseDeliveryWebhook(payload: unknown): DeliveryEvent | null {
    return this.parseDeliveryWebhooks(payload)[0] ?? null;
  }

  parseDeliveryWebhooks(payload: unknown): DeliveryEvent[] {
    const events: DeliveryEvent[] = [];
    for (const value of changeValues(payload)) {
      const statuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const status of statuses as Array<Record<string, unknown>>) {
        if (typeof status.id !== "string" || typeof status.status !== "string") continue;
        const mapped: Record<string, DeliveryEvent["status"]> = { sent: "sent", delivered: "delivered", read: "delivered", failed: "failed" };
        const normalized = mapped[status.status];
        if (!normalized) continue;
        const errors = Array.isArray(status.errors) ? (status.errors as Array<{ code?: number }>) : [];
        const timestamp = typeof status.timestamp === "string" ? Number(status.timestamp) * 1000 : Date.now();
        events.push({ providerMessageId: status.id, status: normalized, errorCode: errors[0]?.code !== undefined ? String(errors[0].code) : undefined, occurredAt: new Date(timestamp) });
      }
    }
    return events;
  }

  parseInboundWebhook(payload: unknown): InboundEvent | null {
    return this.parseInboundWebhooks(payload)[0] ?? null;
  }

  parseInboundWebhooks(payload: unknown): InboundEvent[] {
    const events: InboundEvent[] = [];
    for (const value of changeValues(payload)) {
      const businessNumber = typeof (value.metadata as { display_phone_number?: unknown } | undefined)?.display_phone_number === "string" ? String((value.metadata as { display_phone_number: string }).display_phone_number) : "";
      const messages = Array.isArray(value.messages) ? value.messages : [];
      for (const message of messages as Array<Record<string, unknown>>) {
        if (typeof message.from !== "string" || typeof message.id !== "string") continue;
        const text = message.type === "text" ? (message.text as { body?: unknown } | undefined)?.body : message.type === "button" ? (message.button as { text?: unknown } | undefined)?.text : undefined;
        if (typeof text !== "string") continue;
        const timestamp = typeof message.timestamp === "string" ? Number(message.timestamp) * 1000 : Date.now();
        events.push({ providerMessageId: message.id, from: `+${message.from}`, to: businessNumber ? `+${businessNumber.replace(/^\+/, "")}` : "", body: text, channel: "whatsapp", receivedAt: new Date(timestamp) });
      }
    }
    return events;
  }

  /** Meta signs the raw request body: `X-Hub-Signature-256: sha256=<hmac>` keyed by the app secret. */
  verifyWebhookSignature(payload: unknown, headers: Headers): boolean {
    const raw = typeof payload === "string" ? payload : Buffer.isBuffer(payload) ? payload.toString("utf8") : undefined;
    const signature = headers.get("x-hub-signature-256");
    if (!raw || !signature || !this.settings.appSecret || !signature.startsWith("sha256=")) return false;
    const expected = createHmac("sha256", this.settings.appSecret).update(raw).digest("hex");
    const provided = signature.slice("sha256=".length);
    if (expected.length !== provided.length) return false;
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  }
}

function changeValues(payload: unknown): Array<Record<string, unknown>> {
  if (!payload || typeof payload !== "object") return [];
  const entries = (payload as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  const values: Array<Record<string, unknown>> = [];
  for (const entry of entries as Array<{ changes?: unknown }>) {
    if (!Array.isArray(entry?.changes)) continue;
    for (const change of entry.changes as Array<{ value?: unknown }>) {
      if (change?.value && typeof change.value === "object") values.push(change.value as Record<string, unknown>);
    }
  }
  return values;
}

export const defaultMetaWhatsAppProvider = new MetaWhatsAppProvider();
registerMessagingProvider(defaultMetaWhatsAppProvider);
