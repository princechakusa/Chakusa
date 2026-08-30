import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { assertFeatureAvailable } from "../../lib/entitlements.js";
import { parsePhoneNumber } from "../../lib/phone.js";
import { sendOutboundMessage } from "../../lib/messaging/messagingService.js";
import type { MessagingProvider } from "../../lib/messaging/messagingProvider.js";
import type { SendMessageInput } from "./messages.schemas.js";
import type { Plan, SubscriptionStatus } from "@prisma/client";
import { messagingBudgetAvailable } from "../../lib/messaging/messagingBudget.js";

/**
 * Explicitly, humanly initiated SMS send — the only way an outbound
 * message leaves Chakusa in Phase 2. There is no automation trigger, no
 * worker, and no scheduled path that calls this function; it only ever
 * runs inside a single authenticated HTTP request.
 *
 * Order matters and is deliberate: entitlement, then opt-out, then phone
 * validation, all complete *before* anything is sent or persisted. A
 * rejection at any of these steps creates no Message row at all — only an
 * actual attempt to reach the provider (accepted or not) is logged.
 */
export async function sendMessage(
  businessId: string,
  input: SendMessageInput,
  plan: Plan,
  status: SubscriptionStatus,
  provider?: MessagingProvider,
) {
  // FREE must never reach the provider — see entitlements.ts for why this
  // is OUTBOUND_MESSAGING and not AUTOMATION. Status-aware: a PRO business
  // whose billing lapsed (EXPIRED/CANCELED) must not keep sending real,
  // billable messages just because Subscription.plan still reads "PRO" —
  // see the P0 audit fix in entitlements.ts.
  assertFeatureAvailable(plan, status, "OUTBOUND_MESSAGING");
  if (!(await messagingBudgetAvailable(businessId)).available) throw ApiError.forbidden("The monthly messaging safety limit has been reached");

  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, businessId } });
  if (!customer) {
    throw ApiError.notFound("Customer not found");
  }

  if (input.leadId) {
    const lead = await prisma.lead.findFirst({ where: { id: input.leadId, businessId } });
    if (!lead) {
      throw ApiError.badRequest("leadId does not belong to this business");
    }
  }

  // Reuse the phoneE164 already derived at write time (Phase 1) — never
  // re-parse ad-hoc here. If it's missing, the destination is unresolved;
  // fail deterministically before calling the provider at all.
  if (!customer.phoneE164) {
    throw ApiError.badRequest("Customer does not have a valid E.164 phone number on file", {
      reason: "MISSING_PHONE_E164",
    });
  }

  // Hard block, checked before any send attempt — never send first and
  // check afterward. A matching SMS-specific or ALL-channel opt-out for
  // this business+phone rejects the request outright; no bypass flag is
  // accepted from the client (there is no such input in the schema).
  const optOut = await prisma.customerOptOut.findFirst({
    where: { businessId, phone: customer.phoneE164, channel: { in: ["SMS", "ALL"] } },
  });
  if (optOut) {
    throw ApiError.forbidden("This customer has opted out of SMS messages from this business");
  }

  // customer.phoneE164 is already a valid E.164 string (established at
  // write time); this just reads the country digits back out of it via the
  // same phone.ts utility — not a second, ad-hoc parsing path.
  const countryCode = parsePhoneNumber(customer.phoneE164).country ?? "ZZ";

  // Twilio's standard SMS API has no native idempotency-key mechanism (see
  // the Phase 2 report) — this key is generated fresh per call and passed
  // through the OutboundMessage contract for a future provider/retry layer
  // that might support it, but nothing in this phase relies on Twilio
  // deduplicating anything. The actual protection against duplicate sends
  // in this phase is that a human explicitly triggers exactly one HTTP
  // request per send; automation-level deduplication is out of scope.
  const idempotencyKey = randomUUID();

  const result = await sendOutboundMessage(
    {
      to: customer.phoneE164,
      channel: "sms",
      body: input.body,
      countryCode,
      idempotencyKey,
    },
    provider,
  );

  // "sent" here means Twilio (or whichever provider) accepted the message
  // for delivery — not that a handset received it. No delivery webhook
  // exists yet in this phase, so Chakusa has no way to know more than
  // that; see messagingProvider.ts and the Phase 2 report.
  const message = await prisma.message.create({
    data: {
      businessId,
      customerId: customer.id,
      leadId: input.leadId,
      messageType: input.messageType ?? "custom",
      channel: "sms",
      body: input.body,
      status: result.accepted ? "sent" : "failed",
      sentAt: result.accepted ? new Date() : null,
      provider: "twilio",
      providerMessageId: result.providerMessageId,
    },
  });

  if (!result.accepted) {
    throw ApiError.providerSendFailed({
      provider: "twilio",
      errorCode: result.errorCode,
      permanentFailure: result.permanentFailure,
      messageId: message.id,
    });
  }

  return message;
}
