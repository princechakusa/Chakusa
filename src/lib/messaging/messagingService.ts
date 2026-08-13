import { defaultTwilioProvider } from "./twilioProvider.js";
import type { MessagingProvider, OutboundMessage, SendResult } from "./messagingProvider.js";

// Swap this to select a different provider; nothing outside this module
// should ever import twilioProvider.ts directly — mirrors
// src/lib/push/pushService.ts's defaultProvider/ExpoPushProvider split.
const defaultProvider: MessagingProvider = defaultTwilioProvider;

/**
 * The one function the rest of Chakusa calls to actually send an outbound
 * message. This is the reusable sending primitive — it does not decide
 * *whether* a send should happen (entitlement, opt-out, and validation
 * checks belong to the caller, see
 * src/modules/messages/messages.service.ts); it just sends.
 *
 * `provider` defaults to the real Twilio provider; tests inject a fake one
 * so nothing in the test suite ever makes a real network call.
 */
export async function sendOutboundMessage(
  message: OutboundMessage,
  provider: MessagingProvider = defaultProvider,
): Promise<SendResult> {
  return provider.send(message);
}
