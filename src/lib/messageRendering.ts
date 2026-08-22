import type { Business, Customer, Lead, MessageType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { renderTemplate } from "./templateEngine.js";
import { getDefaultTemplateBody } from "./defaultTemplates.js";
import { LEAD_SOURCE_PUBLIC_PROFILE } from "./leadSources.js";

/**
 * Which MessageType template a lead's automated/generated follow-up should
 * use, keyed by lead.source — mirrors src/lib/leadSources.ts's
 * automation-eligibility gate, but is a separate concern: eligibility says
 * *whether* a source gets an automated follow-up at all, this says *which
 * wording* it gets once it does (or once a business owner manually taps
 * "generate message" for it). Any source not listed here — including null,
 * manual entry, and every source that predates this mapping — falls back
 * to the original "missed_call" wording, exactly as before this map
 * existed, so no existing lead source's generated copy changes.
 */
const TEMPLATE_TYPE_BY_LEAD_SOURCE: Partial<Record<string, MessageType>> = {
  [LEAD_SOURCE_PUBLIC_PROFILE]: "public_profile_inquiry",
};

function templateTypeForLead(source: string | null): MessageType {
  return (source ? TEMPLATE_TYPE_BY_LEAD_SOURCE[source] : undefined) ?? "missed_call";
}

/**
 * The same template lookup + render primitives leads.service.ts's
 * generateLeadMessage (manual "generate message" endpoint) and the
 * automation executor both use — extracted here so neither needs a second
 * template engine or a duplicated lookup. Pure: no writes, no throwing —
 * callers own what to do with a missing lead/customer. Returns the
 * resolved `messageType` alongside the body so a caller that persists a
 * Message row (the automation executor) records the correct type instead
 * of assuming "missed_call".
 */
export async function renderLeadFollowUpMessage(
  business: Business,
  lead: Lead,
  customer: Customer | null,
): Promise<{ body: string; messageType: MessageType }> {
  const messageType = templateTypeForLead(lead.source);

  const template = await prisma.messageTemplate.findFirst({
    where: { businessId: business.id, templateType: messageType },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "asc" }],
  });

  const body = template?.body ?? getDefaultTemplateBody(messageType, business.industry);

  return {
    body: renderTemplate(body, {
      customer_name: customer?.name ?? "there",
      business_name: business.name,
      service_name: lead.serviceRequested ?? "your service",
      phone_number: business.phone ?? "",
    }),
    messageType,
  };
}
