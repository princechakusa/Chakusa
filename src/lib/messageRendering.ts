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

/** Shared template-lookup-then-render step every render* function below uses — a business's own custom template for `messageType` wins if one exists, otherwise the industry-aware default. */
async function renderWithTemplate(
  business: Pick<Business, "id" | "industry" | "name" | "phone">,
  messageType: MessageType,
  variables: Record<string, string>,
): Promise<{ body: string; messageType: MessageType }> {
  const template = await prisma.messageTemplate.findFirst({
    where: { businessId: business.id, templateType: messageType },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "asc" }],
  });
  const body = template?.body ?? getDefaultTemplateBody(messageType, business.industry);
  return { body: renderTemplate(body, variables), messageType };
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
  return renderWithTemplate(business, templateTypeForLead(lead.source), {
    customer_name: customer?.name ?? "there",
    business_name: business.name,
    service_name: lead.serviceRequested ?? "your service",
    phone_number: business.phone ?? "",
  });
}

/**
 * The Customer Lifecycle Automation Engine's LEAD_FOLLOW_UP trigger —
 * deliberately always "lead_follow_up" wording regardless of the lead's
 * source (unlike renderLeadFollowUpMessage above, whose whole point is
 * varying by source). By the time a lead qualifies for this trigger it may
 * already have been contacted once, so the original per-source initial
 * wording no longer applies — this is a distinct "still interested?"
 * check-in, always.
 */
export async function renderLeadStaleFollowUpMessage(
  business: Business,
  lead: Lead,
  customer: Customer | null,
): Promise<{ body: string; messageType: MessageType }> {
  return renderWithTemplate(business, "lead_follow_up", {
    customer_name: customer?.name ?? "there",
    business_name: business.name,
    service_name: lead.serviceRequested ?? "your service",
    phone_number: business.phone ?? "",
  });
}

/**
 * The Customer Lifecycle Automation Engine's CUSTOMER_RETENTION trigger —
 * reuses the comeback_reminder MessageType (the exact same one the manual
 * Reminder feature already uses) rather than inventing a new template
 * type, since the intent — "it's been a while, come back" — is identical.
 * No Lead is involved here (a dormant customer's win-back attempt isn't
 * about any one job), so there is no serviceRequested to interpolate —
 * "your service" is the same generic fallback used everywhere else a
 * service name isn't available.
 */
export async function renderCustomerRetentionMessage(
  business: Business,
  customer: Customer,
): Promise<{ body: string; messageType: MessageType }> {
  return renderWithTemplate(business, "comeback_reminder", {
    customer_name: customer.name,
    business_name: business.name,
    service_name: "your service",
    phone_number: business.phone ?? "",
  });
}
