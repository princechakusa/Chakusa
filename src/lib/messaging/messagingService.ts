import { defaultTwilioProvider } from "./twilioProvider.js";
import type { MessagingProvider, OutboundMessage, SendResult } from "./messagingProvider.js";
import { prisma } from "../prisma.js";

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
  // Platform kill switch (Admin → Settings → communications_enabled). When
  // off, nothing leaves the platform. Reported as a transient failure so
  // callers release their claim and can send once it is switched back on.
  if (!(await communicationsEnabled())) return { accepted: false, errorCode: "COMMUNICATIONS_DISABLED", permanentFailure: false };
  return provider.send(message);
}

const SWITCH_TTL_MS = 15_000;
let cachedSwitch: { value: boolean; at: number } | null = null;

/** Reads the admin kill switch with a short cache; defaults to enabled if unset or unreadable. */
export async function communicationsEnabled(): Promise<boolean> {
  if (cachedSwitch && Date.now() - cachedSwitch.at < SWITCH_TTL_MS) return cachedSwitch.value;
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: "communications_enabled" }, select: { value: true } });
    cachedSwitch = { value: row?.value !== false, at: Date.now() };
  } catch {
    cachedSwitch = { value: cachedSwitch?.value ?? true, at: Date.now() };
  }
  return cachedSwitch.value;
}

/** Test/admin hook: drop the cached switch so the next send re-reads it. */
export function resetCommunicationsSwitchCache() { cachedSwitch = null; }
