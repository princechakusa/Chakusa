import type { Business, Customer, Lead } from "@prisma/client";
import { prisma } from "./prisma.js";
import { renderTemplate } from "./templateEngine.js";
import { getDefaultTemplateBody } from "./defaultTemplates.js";

/**
 * The same template lookup + render primitives leads.service.ts's
 * generateLeadMessage (manual "generate message" endpoint) already uses —
 * extracted here so the automation executor can produce an identical
 * missed-call message without a second template engine or a duplicated
 * lookup. Pure: no writes, no throwing — callers own what to do with a
 * missing lead/customer.
 */
export async function renderMissedCallFollowUp(business: Business, lead: Lead, customer: Customer | null): Promise<string> {
  const template = await prisma.messageTemplate.findFirst({
    where: { businessId: business.id, templateType: "missed_call" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "asc" }],
  });

  const body = template?.body ?? getDefaultTemplateBody("missed_call", business.industry);

  return renderTemplate(body, {
    customer_name: customer?.name ?? "there",
    business_name: business.name,
    service_name: lead.serviceRequested ?? "your service",
    phone_number: business.phone ?? "",
  });
}
