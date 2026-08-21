import { prisma } from "../../lib/prisma.js";
import { findOrCreateCustomerByPhone } from "../customers/customers.service.js";
import { createLead } from "../leads/leads.service.js";
import { LEAD_SOURCE_PUBLIC_PROFILE } from "../../lib/leadSources.js";
import type { SubmitPublicContactInput } from "./public.schemas.js";
import type { Business } from "@prisma/client";

/**
 * Only what a prospective customer needs to decide to reach out — never the
 * owner's id, subscription/plan, or anything else internal. Matches the
 * minimal-exposure discipline of serializeOpenOrSubmittedReview in
 * publicReviews.service.ts.
 */
export interface PublicBusinessProfile {
  name: string;
  industry: string | null;
  phone: string | null;
  googleReviewLink: string | null;
  workingHours: Record<string, unknown> | null;
  defaultServices: string[] | null;
}

export async function resolvePublicBusinessProfile(slug: string): Promise<PublicBusinessProfile | null> {
  const business = await prisma.business.findUnique({ where: { publicSlug: slug } });
  if (!business) return null;

  return serializePublicBusinessProfile(business);
}

function serializePublicBusinessProfile(business: Business): PublicBusinessProfile {
  return {
    name: business.name,
    industry: business.industry,
    phone: business.phone,
    googleReviewLink: business.googleReviewLink,
    workingHours: (business.workingHours as Record<string, unknown> | null) ?? null,
    defaultServices: (business.defaultServices as string[] | null) ?? null,
  };
}

/**
 * A public profile has no authenticated request, so — unlike every
 * authenticated lead-creation path — there is no request.plan/request.actor
 * to reuse. Plan/status are resolved the same defensive way
 * tenant.ts's requireBusiness does for an authenticated request (missing
 * Subscription row defaults to FREE/ACTIVE, the least-privilege fallback).
 * actorId is the business owner: a real User row is required by
 * recordActivity's/createLead's foreign key, and attributing a
 * customer-initiated public submission to the business's own owner is the
 * same convention this codebase already uses for other system-attributed
 * writes with no human actor (see markPublicReviewOpened's actorId: null,
 * which activity events support but createLead's actorId does not).
 */
export async function submitPublicContactForm(
  slug: string,
  input: SubmitPublicContactInput,
): Promise<{ businessName: string } | null> {
  const business = await prisma.business.findUnique({ where: { publicSlug: slug } });
  if (!business) return null;

  const subscription = await prisma.subscription.findUnique({
    where: { businessId: business.id },
    select: { plan: true },
  });
  const plan = subscription?.plan ?? "FREE";

  const customer = await findOrCreateCustomerByPhone(business.id, business.ownerId, input.phone, plan);
  if (customer.created) {
    await prisma.customer.update({ where: { id: customer.id }, data: { name: input.name } });
  }

  await createLead(business.id, business.ownerId, {
    customerId: customer.id,
    source: LEAD_SOURCE_PUBLIC_PROFILE,
    serviceRequested: input.serviceRequested,
    urgency: "medium",
    notes: input.message,
  }, plan);

  return { businessName: business.name };
}
