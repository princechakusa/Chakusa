import { config } from "../config.js";
import { metaWhatsAppActive } from "./defaultMessagingProvider.js";
import { greetingName } from "../templateEngine.js";
import type { OutboundMessage } from "./messagingProvider.js";

// The shared Chakusa WhatsApp sender's Meta-approved templates. WhatsApp
// rejects free-form business-initiated text outside the customer's 24-hour
// window (Twilio error 63016), so the two messages Chakusa starts on its own
// (missed-call follow-up, review request) go out as these templates when
// their Content SIDs are configured. Variable positions are the contract the
// owner's templates in Twilio Content Template Builder (or, when Meta's Cloud
// API is active, the Meta template names in META_WHATSAPP_*_TEMPLATE) follow.

type Template = NonNullable<OutboundMessage["template"]>;

// Template variables cannot be empty, contain newlines/tabs or more than
// four consecutive spaces (Meta rejects the send).
function clean(value: string | null | undefined, fallback: string): string {
  const normalized = (value ?? "").replace(/[\t\r\n]+/g, " ").replace(/ {2,}/g, " ").trim();
  return (normalized || fallback).slice(0, 200);
}

export function firstName(name: string | null | undefined): string {
  return greetingName(clean(name, "there")).split(" ")[0] ?? "there";
}

/** {{1}} = business name. */
export function missedCallWhatsAppTemplate(businessName: string): Template | undefined {
  const contentSid = metaWhatsAppActive() ? config.META_WHATSAPP_MISSED_CALL_TEMPLATE : config.TWILIO_WHATSAPP_MISSED_CALL_CONTENT_SID;
  if (!contentSid) return undefined;
  return { contentSid, variables: { "1": clean(businessName, "our team") } };
}

/** {{1}} = customer first name, {{2}} = business name, {{3}} = review link. */
export function reviewRequestWhatsAppTemplate(customerName: string | null | undefined, businessName: string, reviewLink: string): Template | undefined {
  const contentSid = metaWhatsAppActive() ? config.META_WHATSAPP_REVIEW_REQUEST_TEMPLATE : config.TWILIO_WHATSAPP_REVIEW_REQUEST_CONTENT_SID;
  if (!contentSid) return undefined;
  return { contentSid, variables: { "1": firstName(customerName), "2": clean(businessName, "our team"), "3": reviewLink } };
}
