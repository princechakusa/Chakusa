import type { Plan } from "@prisma/client";
import { prisma } from "../prisma.js";
import { planRank } from "../entitlements.js";

// Owner-granted complimentary plans (COMPLIMENTARY_PLAN_GRANTS), for the
// owner's own testing and comped accounts while store products are not yet
// sellable. Applied at startup. Store-managed subscriptions (provider set)
// are never touched, and a plan is only ever raised, never lowered.

export function parseComplimentaryGrants(raw: string | undefined) {
  if (!raw) return [];
  return raw.split(",").map((part) => part.trim()).filter(Boolean).flatMap((part) => {
    const at = part.lastIndexOf(":");
    const email = part.slice(0, at).trim().toLowerCase();
    const plan = part.slice(at + 1).trim().toUpperCase();
    return at > 0 && email.includes("@") && (plan === "STARTER" || plan === "PRO" || plan === "BUSINESS") ? [{ email, plan: plan as Plan }] : [];
  });
}

export async function applyComplimentaryPlans(raw: string | undefined) {
  const applied: Array<{ email: string; businessId: string; plan: Plan }> = [];
  for (const grant of parseComplimentaryGrants(raw)) {
    const owner = await prisma.user.findFirst({ where: { email: { equals: grant.email, mode: "insensitive" } }, select: { id: true } });
    if (!owner) continue;
    const businesses = await prisma.business.findMany({ where: { ownerId: owner.id }, select: { id: true, subscription: { select: { plan: true, status: true, provider: true } } } });
    for (const business of businesses) {
      const current = business.subscription;
      if (current?.provider) continue;
      if (current && current.status === "ACTIVE" && planRank(current.plan) >= planRank(grant.plan)) continue;
      await prisma.subscription.upsert({
        where: { businessId: business.id },
        create: { businessId: business.id, plan: grant.plan, status: "ACTIVE" },
        update: { plan: grant.plan, status: "ACTIVE" },
      });
      applied.push({ email: grant.email, businessId: business.id, plan: grant.plan });
    }
  }
  return applied;
}
