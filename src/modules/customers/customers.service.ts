import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { assertUnderLimit, getPlanLimits, withLimitCheck } from "../../lib/entitlements.js";
import { toE164OrNull } from "../../lib/phone.js";
import { toApiLead } from "../leads/leads.serialization.js";
import { classifyCustomerLifecycleStage } from "../../lib/customerLifecycle.js";
import { deriveCommunicationStatuses } from "../../lib/communicationStatus.js";
import { buildCommunicationTimeline } from "../../lib/communicationTimeline.js";
import { generateCustomerCoachingHighlight } from "../../lib/customerCoachingHighlight.js";
import type { BulkImportCustomersInput, CreateCustomerInput, UpdateCustomerInput } from "./customers.schemas.js";
import { Prisma, type Lead, type Plan } from "@prisma/client";
import type { CountryCode } from "libphonenumber-js";
import { recordOutboxEvent } from "../../lib/outbox.js";

/**
 * Best-effort E.164 derivation for a customer's phone — never blocks the
 * write. The owning business's `country` is the default region for
 * interpreting a bare local number; without it, only already-international
 * numbers ("+…") can be normalized. Returns undefined (not null) when
 * `phone` isn't part of this input at all, so a Prisma `data` spread never
 * clobbers an existing phoneE164 value on an unrelated field update.
 */
async function derivePhoneE164(businessId: string, phone: string | null | undefined): Promise<string | null | undefined> {
  if (phone === undefined) return undefined;
  if (!phone) return null;

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { country: true } });
  return toE164OrNull(phone, (business?.country as CountryCode | null) ?? undefined);
}

export async function listCustomers(
  businessId: string,
  opts: { search?: string; page: number; pageSize: number },
) {
  const where = {
    businessId,
    ...(opts.search
      ? {
          OR: [
            { name: { contains: opts.search, mode: "insensitive" as const } },
            { phone: { contains: opts.search, mode: "insensitive" as const } },
            { email: { contains: opts.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    prisma.customer.count({ where }),
  ]);

  return { items, total, page: opts.page, pageSize: opts.pageSize };
}

export async function createCustomer(
  businessId: string,
  actorId: string,
  input: CreateCustomerInput,
  plan: Plan,
) {
  const limit = getPlanLimits(plan).customers;
  const phoneE164 = await derivePhoneE164(businessId, input.phone);

  const customer = await withLimitCheck(async (tx) => {
    if (limit !== null) {
      const current = await tx.customer.count({ where: { businessId } });
      assertUnderLimit({ plan, resource: "customers", limit, current });
    }

    const created = await tx.customer.create({ data: { businessId, ...input, phoneE164, customFields: input.customFields as Prisma.InputJsonValue | undefined } });
    await recordOutboxEvent(tx, { dedupeKey: `customer:${created.id}:created`, aggregateType: "customer", aggregateId: created.id, eventType: "CustomerCreated", tenantId: businessId, businessId, payload: { id: created.id } });
    return created;
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: "CUSTOMER_CREATED",
    entityType: "customer",
    entityId: customer.id,
  });

  return customer;
}

/**
 * Bulk-onboards a business's existing customer list from CSV/paste-in rows
 * the client already parsed — deliberately not a device-contacts import.
 * Chakusa's published Privacy Policy commits to never reading, storing, or
 * uploading the phone's address book beyond a narrow, system-level Android
 * call-screening check; a "scan your contacts" growth flow would break that
 * commitment and also require a new sensitive Android permission with its
 * own Play Store review risk. This is the one bulk-onboarding path Chakusa
 * offers instead — same growth outcome (fast bulk-add of an existing list),
 * no new permission, no policy change.
 *
 * Same per-recipient isolation as bulkCreateReviewRequests/bulkSendReminders:
 * one bad row (duplicate phone, or the plan's customer limit already
 * reached) never blocks the rest of the import. Rows are deduped against
 * existing customers by normalized phone the same way
 * findOrCreateCustomerByPhone matches a repeat caller — a row with no phone,
 * or one that fails to normalize, always creates a new Customer rather than
 * guessing a match from name alone.
 */
export async function bulkImportCustomers(
  businessId: string,
  actorId: string,
  input: BulkImportCustomersInput,
  plan: Plan,
) {
  const limit = getPlanLimits(plan).customers;
  let current = limit === null ? 0 : await prisma.customer.count({ where: { businessId } });

  const created: { id: string; name: string }[] = [];
  const skipped: { name: string; reason: "duplicate_phone" | "limit_reached" }[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (const row of input.customers) {
    try {
      if (limit !== null && current >= limit) {
        skipped.push({ name: row.name, reason: "limit_reached" });
        continue;
      }

      const phoneE164 = await derivePhoneE164(businessId, row.phone);
      if (phoneE164) {
        const existing = await prisma.customer.findFirst({ where: { businessId, phoneE164 }, select: { id: true } });
        if (existing) {
          skipped.push({ name: row.name, reason: "duplicate_phone" });
          continue;
        }
      }

      const customer = await prisma.$transaction(async (tx) => { const createdCustomer = await tx.customer.create({ data: { businessId, name: row.name, phone: row.phone, email: row.email, notes: row.notes, phoneE164 } }); await recordOutboxEvent(tx, { dedupeKey: `customer:${createdCustomer.id}:created`, aggregateType: "customer", aggregateId: createdCustomer.id, eventType: "CustomerCreated", tenantId: businessId, businessId, payload: { id: createdCustomer.id } }); await recordActivity({ businessId, actorId, eventType: "CUSTOMER_CREATED", entityType: "customer", entityId: createdCustomer.id, metadata: { source: "bulk_import" } }, tx); return createdCustomer; });
      current += 1;
      created.push({ id: customer.id, name: customer.name });

    } catch (error) {
      failed.push({ name: row.name, reason: error instanceof Error ? error.message : "Could not import this customer" });
    }
  }

  return { created, skipped, failed };
}

/**
 * Resolves a caller's phone number to a Customer, creating one only if no
 * match exists yet. Matches on the normalized E.164 form (not the raw
 * `phone` string) so "0771234567" and "+263771234567" from the same caller
 * resolve to the same Customer rather than silently duplicating them —
 * something the existing manual "new caller" lead form does not do today
 * (it always inserts a fresh Customer), which would be a real correctness
 * bug for an automated connector expected to see the same repeat caller
 * many times. Falls back to creating an un-matchable Customer (phoneE164
 * null) when the number can't be normalized, rather than failing ingestion
 * entirely — a name-less, best-effort Customer is still far more useful
 * than dropping a real missed call.
 */
export async function findOrCreateCustomerByPhone(
  businessId: string,
  actorId: string,
  rawPhone: string,
  plan: Plan,
): Promise<{ id: string; created: boolean }> {
  const phoneE164 = await derivePhoneE164(businessId, rawPhone);

  if (phoneE164) {
    const existing = await prisma.customer.findFirst({
      where: { businessId, phoneE164 },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };
  }

  const limit = getPlanLimits(plan).customers;
  const customer = await withLimitCheck(async (tx) => {
    if (limit !== null) {
      const current = await tx.customer.count({ where: { businessId } });
      assertUnderLimit({ plan, resource: "customers", limit, current });
    }
    const created = await tx.customer.create({
      data: { businessId, name: rawPhone, phone: rawPhone, phoneE164 },
    });
    await recordOutboxEvent(tx, { dedupeKey: `customer:${created.id}:created`, aggregateType: "customer", aggregateId: created.id, eventType: "CustomerCreated", tenantId: businessId, businessId, payload: { id: created.id } });
    return created;
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: "CUSTOMER_CREATED",
    entityType: "customer",
    entityId: customer.id,
  });

  return { id: customer.id, created: true };
}

async function assertCustomerInBusiness(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) {
    throw ApiError.notFound("Customer not found");
  }
  return customer;
}

/** Reuses classifyCustomerLifecycleStage (src/lib/customerLifecycle.ts) against one customer's own already-fetched leads — no new query, the same aggregation insights.service.ts already does per-business, just scoped to one customer. */
function lifecycleStageForCustomer(leads: Lead[], now: Date) {
  const wonLeads = leads.filter((lead) => lead.status === "won");
  const lifetimeValue = wonLeads.filter((lead) => lead.estimatedValue).reduce((sum, lead) => sum + Number(lead.estimatedValue), 0);
  const lastActivityAt = leads.length > 0 ? Math.max(...leads.map((lead) => lead.createdAt.getTime())) : null;

  const stage = classifyCustomerLifecycleStage({
    lostLeadCount: leads.filter((lead) => lead.status === "lost").length,
    contactedOrBookedLeadCount: leads.filter((lead) => lead.status === "contacted" || lead.status === "booked").length,
    newLeadCount: leads.filter((lead) => lead.status === "new").length,
    wonLeadCount: wonLeads.length,
    lifetimeValue,
    daysSinceLastActivity: lastActivityAt == null ? null : Math.floor((now.getTime() - lastActivityAt) / 86_400_000),
  });

  return { stage, lifetimeValue, wonLeadCount: wonLeads.length, daysSinceLastActivity: lastActivityAt == null ? null : Math.floor((now.getTime() - lastActivityAt) / 86_400_000) };
}

export async function getCustomerProfile(businessId: string, customerId: string) {
  await assertCustomerInBusiness(businessId, customerId);
  const now = new Date();

  const [customer, leads, reviewRequests, feedback, reminders, activity, messages, appointments] = await Promise.all([
    prisma.customer.findFirst({ where: { id: customerId, businessId } }),
    prisma.lead.findMany({ where: { businessId, customerId }, orderBy: { createdAt: "desc" } }),
    prisma.reviewRequest.findMany({
      where: { businessId, customerId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.feedback.findMany({ where: { businessId, customerId }, orderBy: { createdAt: "desc" } }),
    prisma.reminder.findMany({ where: { businessId, customerId }, orderBy: { dueDate: "desc" } }),
    prisma.activityEvent.findMany({
      where: { businessId, entityType: "customer", entityId: customerId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.message.findMany({ where: { businessId, customerId }, orderBy: { createdAt: "desc" } }),
    prisma.appointment.findMany({ where: { businessId, customerId }, orderBy: { startsAt: "desc" }, take: 100, include: { assignedMember: { include: { user: { select: { id: true, fullName: true, email: true } } } } } }),
  ]);

  const lifetimeValue = leads
    .filter((lead) => lead.status === "won" && lead.estimatedValue)
    .reduce((sum, lead) => sum + Number(lead.estimatedValue), 0);

  const { stage: lifecycleStage, wonLeadCount, daysSinceLastActivity } = lifecycleStageForCustomer(leads, now);
  const hasOutstandingPayment = leads.some((lead) => lead.status === "won" && lead.paymentStatus !== "paid");
  const outstandingLead = leads.find((lead) => lead.status === "won" && lead.paymentStatus !== "paid");
  const outstandingAmount = outstandingLead?.estimatedValue != null ? `$${(Number(outstandingLead.estimatedValue) - Number(outstandingLead.paidAmount ?? 0)).toFixed(2)}` : null;

  const communicationStatuses = deriveCommunicationStatuses({
    hasOpenLead: leads.some((lead) => lead.status === "new" || lead.status === "contacted" || lead.status === "booked"),
    hasPendingReviewRequest: reviewRequests.some((review) => review.status === "pending" || review.status === "sent" || review.status === "opened"),
    hasDueReminder: reminders.some((reminder) => reminder.status === "due" && reminder.dueDate <= now),
    hasOutstandingPayment,
    lifecycleStage,
  });

  const communicationTimeline = buildCommunicationTimeline({ leads, messages, reviewRequests, feedback, reminders, now });

  const assistantHighlight = generateCustomerCoachingHighlight({
    customerName: customer?.name ?? "This customer",
    lifecycleStage,
    daysSinceLastActivity,
    hasOutstandingPayment,
    outstandingAmount,
    hasDueReminder: reminders.some((reminder) => reminder.status === "due" && reminder.dueDate <= now),
    hasAnyReviewRequest: reviewRequests.length > 0,
    wonLeadCount,
  });

  return {
    customer,
    leads: leads.map(toApiLead),
    reviewRequests,
    feedback,
    reminders,
    activity,
    messages,
    appointments,
    lifetimeValue,
    lifecycleStage,
    communicationStatuses,
    communicationTimeline,
    assistantHighlight,
  };
}

export async function updateCustomer(
  businessId: string,
  actorId: string,
  customerId: string,
  input: UpdateCustomerInput,
) {
  await assertCustomerInBusiness(businessId, customerId);
  const phoneE164 = await derivePhoneE164(businessId, input.phone);

  const customer = await prisma.$transaction(async (tx) => {
    const updated = await tx.customer.update({ where: { id: customerId }, data: { ...input, phoneE164, customFields: input.customFields as Prisma.InputJsonValue | undefined } });
    await recordOutboxEvent(tx, { dedupeKey: `customer:${customerId}:updated:${updated.updatedAt.toISOString()}`, aggregateType: "customer", aggregateId: customerId, eventType: "CustomerUpdated", tenantId: businessId, businessId, payload: { id: customerId } });
    return updated;
  });

  await recordActivity({
    businessId,
    actorId,
    eventType: "CUSTOMER_UPDATED",
    entityType: "customer",
    entityId: customer.id,
  });

  return customer;
}
