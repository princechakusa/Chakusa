import { prisma } from "../prisma.js";

// Customer SMS consent captured at the point the phone number is used for
// booking. Twilio toll-free verification requires an explicit, unticked
// opt-in with this disclosure; chakusarecovery.com/sms publishes the same text.
// Rows go to the existing per-business CustomerConsentEvent ledger, so a
// customer's choice with one business never affects another business.

export const SMS_CONSENT_CHANNEL = "SMS";
export const SMS_CONSENT_PURPOSE = "APPOINTMENT_TEXTS";
export const SMS_CONSENT_DISCLOSURE_VERSION = "2026-10-14";

export function smsConsentDisclosure(businessName: string) {
  return `I agree to receive appointment text messages (confirmations, reminders and updates) from ${businessName} via Chakusa at the phone number on my account. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of booking.`;
}

export async function recordSmsConsent(input: {
  businessId: string;
  customerId: string;
  businessName: string;
  granted: boolean;
  source: string;
  evidence?: Record<string, unknown>;
}) {
  await prisma.customerConsentEvent.create({
    data: {
      businessId: input.businessId,
      customerId: input.customerId,
      channel: SMS_CONSENT_CHANNEL,
      purpose: SMS_CONSENT_PURPOSE,
      granted: input.granted,
      source: input.source,
      legalBasis: "consent",
      evidence: { disclosureVersion: SMS_CONSENT_DISCLOSURE_VERSION, disclosure: smsConsentDisclosure(input.businessName), ...input.evidence },
    },
  });
}

/** True when this customer's most recent SMS consent choice with this business was a decline. */
export async function smsConsentDeclined(businessId: string, customerId: string) {
  const latest = await prisma.customerConsentEvent.findFirst({
    where: { businessId, customerId, channel: SMS_CONSENT_CHANNEL, purpose: SMS_CONSENT_PURPOSE },
    orderBy: { occurredAt: "desc" },
    select: { granted: true },
  });
  return latest?.granted === false;
}
