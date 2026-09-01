import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { recordCustomerActivity } from "../customer/customerContext.js";
import { notifyLoyalty } from "./notifications.js";

// PROGRAM 2 LOOP 5: memberships. A MembershipPlan is business-defined config;
// a CustomerMembership records a customer's entitlement. NO charge is taken —
// enrolment and renewal only move the period window. Member pricing is a
// computed discount surfaced to the Booking Platform, never a payment.

const INTERVALS = ["monthly", "annual", "unlimited"] as const;
export type BillingInterval = (typeof INTERVALS)[number];

function periodEnd(interval: BillingInterval, from = new Date()): Date | null {
  if (interval === "unlimited") return null;
  const end = new Date(from);
  if (interval === "monthly") end.setMonth(end.getMonth() + 1);
  else end.setFullYear(end.getFullYear() + 1);
  return end;
}

// --- Plans (business-managed) --------------------------------------------

export async function listMembershipPlans(businessId: string, activeOnly = false) {
  return prisma.membershipPlan.findMany({
    where: { businessId, ...(activeOnly ? { active: true } : {}) },
    orderBy: [{ active: "desc" }, { priceAmount: "asc" }],
    take: 100,
  });
}

export async function createMembershipPlan(businessId: string, actorUserId: string | null, input: {
  name: string; description?: string; billingInterval: BillingInterval; priceAmount: number; currency?: string;
  priorityBooking?: boolean; discountPercent?: number; includedServiceIds?: string[]; perks?: string[];
}) {
  if (!INTERVALS.includes(input.billingInterval)) throw ApiError.badRequest("Unknown billing interval");
  if (input.discountPercent !== undefined && (input.discountPercent < 0 || input.discountPercent > 100)) throw ApiError.badRequest("discountPercent must be 0-100");
  return prisma.membershipPlan.create({
    data: {
      businessId,
      createdByUserId: actorUserId,
      name: input.name,
      description: input.description ?? null,
      billingInterval: input.billingInterval,
      priceAmount: input.priceAmount,
      currency: input.currency ?? null,
      priorityBooking: input.priorityBooking ?? false,
      discountPercent: input.discountPercent ?? 0,
      includedServiceIds: (input.includedServiceIds ?? undefined) as never,
      perks: (input.perks ?? undefined) as never,
    },
  });
}

export async function updateMembershipPlan(businessId: string, id: string, patch: Record<string, unknown>) {
  const existing = await prisma.membershipPlan.findFirst({ where: { id, businessId }, select: { id: true } });
  if (!existing) throw ApiError.notFound("Membership plan not found");
  const allowed = ["name", "description", "priceAmount", "currency", "priorityBooking", "discountPercent", "active"] as const;
  const data: Record<string, unknown> = {};
  for (const key of allowed) if (patch[key] !== undefined) data[key] = patch[key];
  if (patch.includedServiceIds !== undefined) data.includedServiceIds = patch.includedServiceIds;
  if (patch.perks !== undefined) data.perks = patch.perks;
  return prisma.membershipPlan.update({ where: { id }, data });
}

export async function deleteMembershipPlan(businessId: string, id: string) {
  await prisma.membershipPlan.updateMany({ where: { id, businessId }, data: { active: false } });
  return { deactivated: id };
}

// --- Enrolment (customer) ----------------------------------------------

export async function enrolMembership(customerProfileId: string, businessId: string, planId: string) {
  const plan = await prisma.membershipPlan.findFirst({ where: { id: planId, businessId, active: true } });
  if (!plan) throw ApiError.notFound("Membership plan not found");

  const existing = await prisma.customerMembership.findFirst({ where: { businessId, customerProfileId, status: "active" } });
  if (existing) throw ApiError.conflict("You already have an active membership with this business");

  const now = new Date();
  const membership = await prisma.customerMembership.create({
    data: {
      businessId,
      customerProfileId,
      planId,
      status: "active",
      billingInterval: plan.billingInterval,
      startedAt: now,
      currentPeriodEnd: periodEnd(plan.billingInterval as BillingInterval, now),
      autoRenew: plan.billingInterval !== "unlimited",
    },
  });
  await recordCustomerActivity({ customerProfileId, businessId, type: "MEMBERSHIP_STARTED", entityType: "customer_membership", entityId: membership.id, metadata: { plan: plan.name, interval: plan.billingInterval } });
  return membership;
}

export async function cancelMembership(customerProfileId: string, membershipId: string, immediate = false) {
  const membership = await prisma.customerMembership.findFirst({ where: { id: membershipId, customerProfileId } });
  if (!membership) throw ApiError.notFound("Membership not found");
  if (membership.status !== "active") throw ApiError.conflict("This membership is not active");
  const updated = await prisma.customerMembership.update({
    where: { id: membershipId },
    data: immediate || !membership.currentPeriodEnd
      ? { status: "cancelled", cancelledAt: new Date(), autoRenew: false, cancelAtPeriodEnd: false }
      : { cancelAtPeriodEnd: true, autoRenew: false },
  });
  await recordCustomerActivity({ customerProfileId, businessId: membership.businessId, type: "MEMBERSHIP_CANCELLED", entityType: "customer_membership", entityId: membershipId, metadata: { immediate } });
  return updated;
}

/** Batch: expire memberships whose period ended, renew the auto-renewing ones. */
export async function processMembershipRenewals(now = new Date()): Promise<{ renewed: number; expired: number }> {
  const due = await prisma.customerMembership.findMany({
    where: { status: "active", currentPeriodEnd: { not: null, lt: now } },
    include: { plan: { select: { name: true, billingInterval: true } } },
  });
  let renewed = 0;
  let expired = 0;
  for (const membership of due) {
    if (membership.cancelAtPeriodEnd || !membership.autoRenew) {
      await prisma.customerMembership.update({ where: { id: membership.id }, data: { status: "expired" } });
      expired += 1;
      await notifyLoyalty(membership.customerProfileId, membership.businessId, "membership_expiring", { plan: membership.plan.name, on: "today" }).catch(() => undefined);
    } else {
      await prisma.customerMembership.update({
        where: { id: membership.id },
        data: { currentPeriodEnd: periodEnd(membership.billingInterval as BillingInterval, membership.currentPeriodEnd ?? now) },
      });
      renewed += 1;
      await notifyLoyalty(membership.customerProfileId, membership.businessId, "membership_renewal", { plan: membership.plan.name }).catch(() => undefined);
    }
  }
  return { renewed, expired };
}

export async function activeMembershipFor(businessId: string, customerProfileId: string) {
  return prisma.customerMembership.findFirst({
    where: { businessId, customerProfileId, status: "active" },
    include: { plan: true },
  });
}

/** Member vs list price for a service — computed discount, not a charge. */
export async function membershipPricing(businessId: string, customerProfileId: string | null, listPrice: number | null) {
  if (listPrice == null) return { listPrice: null, memberPrice: null, discountPercent: 0, priorityBooking: false, isMember: false };
  const membership = customerProfileId ? await activeMembershipFor(businessId, customerProfileId) : null;
  if (!membership) return { listPrice, memberPrice: listPrice, discountPercent: 0, priorityBooking: false, isMember: false };
  const discountPercent = membership.plan.discountPercent;
  const memberPrice = Number((listPrice * (1 - discountPercent / 100)).toFixed(2));
  return { listPrice, memberPrice, discountPercent, priorityBooking: membership.plan.priorityBooking, isMember: true, planName: membership.plan.name };
}

export async function listMyMemberships(customerProfileId: string) {
  const rows = await prisma.customerMembership.findMany({
    where: { customerProfileId },
    orderBy: [{ status: "asc" }, { startedAt: "desc" }],
    include: { plan: true },
  });
  const businessIds = [...new Set(rows.map((r) => r.businessId))];
  const businesses = businessIds.length ? await prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true, publicSlug: true } }) : [];
  const byId = new Map(businesses.map((b) => [b.id, b]));
  return rows.map((r) => ({
    id: r.id, status: r.status, billingInterval: r.billingInterval, startedAt: r.startedAt, currentPeriodEnd: r.currentPeriodEnd,
    cancelAtPeriodEnd: r.cancelAtPeriodEnd, autoRenew: r.autoRenew,
    plan: { id: r.plan.id, name: r.plan.name, priceAmount: r.plan.priceAmount, currency: r.plan.currency, discountPercent: r.plan.discountPercent, priorityBooking: r.plan.priorityBooking, perks: r.plan.perks },
    business: byId.get(r.businessId) ?? null,
  }));
}
