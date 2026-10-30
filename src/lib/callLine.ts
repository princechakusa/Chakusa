import { prisma } from "./prisma.js";
import { resolveSubscription, SUBSCRIPTION_ENTITLEMENT_SELECT } from "./entitlements.js";
import { createLeadFromMissedCall } from "../modules/leads/leads.service.js";

const escapeXml = (value: string) => value.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char] ?? char);

const twiml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;

/**
 * A call that reaches a business's Chakusa call line was not answered by the
 * owner (their phone forwards it here), so it is a missed call. iPhone gives
 * apps no call access, which makes this the only iPhone detection path.
 * Always answers with TwiML, never an error, so the caller hears a clean
 * greeting. Retries of the same CallSid are idempotent (clientEventId).
 */
export async function handleCallLineCall(input: { to: string; from: string; callSid: string }): Promise<string> {
  const business = await prisma.business.findUnique({ where: { callLineE164: input.to }, select: { id: true, ownerId: true, name: true, platformStatus: true } });
  if (!business || business.platformStatus !== "ACTIVE") return twiml("<Hangup/>");

  // Withheld or non-numeric caller ids cannot be followed up.
  if (/^\+[1-9]\d{6,14}$/.test(input.from)) {
    const subscription = await prisma.subscription.findUnique({ where: { businessId: business.id }, select: SUBSCRIPTION_ENTITLEMENT_SELECT });
    await createLeadFromMissedCall(business.id, business.ownerId, { phone: input.from, occurredAt: new Date(), clientEventId: `call-${input.callSid}` }, resolveSubscription(subscription).plan);
  }
  return twiml(`<Say>Thanks for calling ${escapeXml(business.name)}. We missed your call and will message you shortly.</Say><Hangup/>`);
}
