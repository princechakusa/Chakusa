import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { assertUnderLimit, getPlanLimits, withLimitCheck } from "../../lib/entitlements.js";
import { toE164OrNull } from "../../lib/phone.js";
import { toApiLead } from "../leads/leads.serialization.js";
import type { CreateCustomerInput, UpdateCustomerInput } from "./customers.schemas.js";
import type { Plan } from "@prisma/client";
import type { CountryCode } from "libphonenumber-js";

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

    return tx.customer.create({ data: { businessId, ...input, phoneE164 } });
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

async function assertCustomerInBusiness(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId } });
  if (!customer) {
    throw ApiError.notFound("Customer not found");
  }
  return customer;
}

export async function getCustomerProfile(businessId: string, customerId: string) {
  await assertCustomerInBusiness(businessId, customerId);

  const [customer, leads, reviewRequests, feedback, reminders, activity] = await Promise.all([
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
  ]);

  const lifetimeValue = leads
    .filter((lead) => lead.status === "won" && lead.estimatedValue)
    .reduce((sum, lead) => sum + Number(lead.estimatedValue), 0);

  return {
    customer,
    leads: leads.map(toApiLead),
    reviewRequests,
    feedback,
    reminders,
    activity,
    lifetimeValue,
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

  const customer = await prisma.customer.update({
    where: { id: customerId },
    data: { ...input, phoneE164 },
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
