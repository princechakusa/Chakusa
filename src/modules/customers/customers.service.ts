import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { recordActivity } from "../../lib/activity.js";
import { toApiLead } from "../leads/leads.serialization.js";
import type { CreateCustomerInput, UpdateCustomerInput } from "./customers.schemas.js";

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
) {
  const customer = await prisma.customer.create({
    data: { businessId, ...input },
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

  const customer = await prisma.customer.update({
    where: { id: customerId },
    data: input,
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
