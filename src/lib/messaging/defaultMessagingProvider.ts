import { config } from "../config.js";
import { defaultMetaWhatsAppProvider } from "./metaWhatsAppProvider.js";
import { defaultTwilioProvider } from "./twilioProvider.js";
import type { MessagingChannel, MessagingProvider, OutboundMessage } from "./messagingProvider.js";

/** True when WhatsApp should go out through Meta's Cloud API instead of Twilio. */
export function metaWhatsAppActive(): boolean {
  return Boolean(config.META_WHATSAPP_ENABLED) && defaultMetaWhatsAppProvider.isConfigured();
}

/** True when the API can actually deliver an outbound SMS or WhatsApp message (a sender is enabled and configured). */
export function outboundMessagingConfigured(): boolean {
  if (metaWhatsAppActive()) return true;
  return Boolean(config.TWILIO_ENABLED && config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && (config.TWILIO_FROM_NUMBER || config.TWILIO_MESSAGING_SERVICE_SID || config.TWILIO_WHATSAPP_FROM));
}

/**
 * The app-wide default sender: WhatsApp goes through Meta's Cloud API when it
 * is enabled and configured, everything else (SMS, and WhatsApp when Meta is
 * off) goes through Twilio. Callers keep depending only on MessagingProvider.
 */
class ChannelRoutingMessagingProvider implements MessagingProvider {
  readonly id = "twilio";

  private forChannel(channel: MessagingChannel): MessagingProvider {
    return channel === "whatsapp" && metaWhatsAppActive() ? defaultMetaWhatsAppProvider : defaultTwilioProvider;
  }

  supportsChannel(channel: MessagingChannel) {
    return this.forChannel(channel).supportsChannel(channel);
  }

  send(message: OutboundMessage) {
    return this.forChannel(message.channel).send(message);
  }

  parseDeliveryWebhook(payload: unknown, _headers?: Headers) {
    return defaultTwilioProvider.parseDeliveryWebhook(payload);
  }

  parseInboundWebhook(payload: unknown, _headers?: Headers) {
    return defaultTwilioProvider.parseInboundWebhook(payload);
  }

  verifyWebhookSignature(payload: unknown, headers: Headers, url?: string) {
    return defaultTwilioProvider.verifyWebhookSignature(payload, headers, url);
  }
}

export const defaultMessagingProvider: MessagingProvider = new ChannelRoutingMessagingProvider();
