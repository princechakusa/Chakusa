import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { renderTemplate } from "../../lib/templateEngine.js";
import { getDefaultTemplateBody } from "../../lib/defaultTemplates.js";
import { toApiLead } from "./leads.serialization.js";
import type { CreateLeadInput, UpdateLeadInput } from "./leads.schemas.js";
import type { Lead } from "@prisma/client";

export async function listLeads(
  businessId: string,
  opts: { status?: string; page: number; pageSize: number },
) {
  const where = { businessId, ...(opts.status ? { status: opts.status as Lead["status"] } : {}) };

  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: { customer: true },
    }),
    prisma.lead.count({ where }),
  ]);

  return { items: items.map(withResponseTime), total, page: opts.page, pageSize: opts.pageSize };
}

function withResponseTime<T extends Lead>(lead: T) {
  const responseTimeSeconds =
    lead.missedCallTime && lead.contactedAt
      ? Math.max(0, Math.floor((lead.contactedAt.getTime() - lead.missedCallTime.getTime()) / 1000))
      : null;
  return { ...toApiLead(lead), responseTimeSeconds };
}

export async function createLead(businessId: string, actorId: string, input: CreateLeadInput) {
  if (input.customerId) {
    await assertCustomerInBusiness(businessId, input.customerId);
  }

  const lead = await prisma.lead.create({
    data: {
      businessId,
      customerId: input.customerId,
      source: input.source,
      missedCallTime: input.missedCallTime,
      serviceRequested: input.serviceRequested,
      urgency: input.urgency,
      estimatedValue: input.estimatedValue,
      notes: input.notes,
    },
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: "LEAD_CREATED",
    entityType: "lead",
    entityId: lead.id,
  });

  return withResponseTime(lead);
}

async function assertCustomerInBusiness(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) {
    throw ApiError.badRequest("customerId does not belong to this business");
  }
}

async function getOwnedLead(businessId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({ where: { id: leadId, businessId } });
  if (!lead) {
    throw ApiError.notFound("Lead not found");
  }
  return lead;
}

export async function getLead(businessId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, businessId },
    include: { customer: true, messages: { orderBy: { createdAt: "desc" } } },
  });
  if (!lead) {
    throw ApiError.notFound("Lead not found");
  }
  return withResponseTime(lead);
}

export async function updateLead(
  businessId: string,
  leadId: string,
  input: UpdateLeadInput,
) {
  await getOwnedLead(businessId, leadId);
  if (input.customerId) {
    await assertCustomerInBusiness(businessId, input.customerId);
  }

  const lead = await prisma.lead.update({
    where: { id: leadId },
    data: {
      customerId: input.customerId,
      source: input.source,
      serviceRequested: input.serviceRequested,
      urgency: input.urgency,
      estimatedValue: input.estimatedValue,
      notes: input.notes,
    },
  });

  return withResponseTime(lead);
}

export async function generateLeadMessage(businessId: string, leadId: string) {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, businessId },
    include: { customer: true },
  });
  if (!lead) {
    throw ApiError.notFound("Lead not found");
  }

  const business = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });

  const template = await prisma.messageTemplate.findFirst({
    where: { businessId, templateType: "missed_call" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "asc" }],
  });

  const body = template?.body ?? getDefaultTemplateBody("missed_call", business.industry);

  const rendered = renderTemplate(body, {
    customer_name: lead.customer?.name ?? "there",
    business_name: business.name,
    service_name: lead.serviceRequested ?? "your service",
    phone_number: business.phone ?? "",
  });

  await prisma.lead.update({ where: { id: leadId }, data: { generatedReply: rendered } });

  return { message: rendered };
}

const STATUS_TRANSITIONS: Record<
  "contacted" | "booked" | "won" | "lost",
  { field: "contactedAt" | "bookedAt" | "wonAt" | "lostAt"; eventType: "LEAD_CONTACTED" | "LEAD_BOOKED" | "LEAD_WON" | "LEAD_LOST" }
> = {
  contacted: { field: "contactedAt", eventType: "LEAD_CONTACTED" },
  booked: { field: "bookedAt", eventType: "LEAD_BOOKED" },
  won: { field: "wonAt", eventType: "LEAD_WON" },
  lost: { field: "lostAt", eventType: "LEAD_LOST" },
};

export async function transitionLead(
  businessId: string,
  actorId: string,
  leadId: string,
  status: "contacted" | "booked" | "won" | "lost",
) {
  await getOwnedLead(businessId, leadId);

  const transition = STATUS_TRANSITIONS[status];
  const now = new Date();

  const lead = await prisma.lead.update({
    where: { id: leadId },
    data: { status, [transition.field]: now },
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: transition.eventType,
    entityType: "lead",
    entityId: lead.id,
  });

  return withResponseTime(lead);
}
