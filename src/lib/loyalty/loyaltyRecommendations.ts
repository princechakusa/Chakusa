import { prisma } from "../prisma.js";
import { resolveTier, nextTier } from "./program.js";

// PROGRAM 2 LOOP 5: explainable loyalty guidance for the Customer AI
// Assistant. Every item is derived from the customer's real accounts and a
// business's real reward/membership rows — nothing is invented, and each
// carries a `reason`.

export interface LoyaltyRecommendation {
  type: "reward_within_reach" | "tier_upgrade" | "membership_saves" | "expiring_points" | "redeem_now";
  businessId: string;
  businessName: string;
  slug: string | null;
  reason: string;
  pointsAway?: number;
  savingsEstimate?: number;
}

export async function loyaltyRecommendations(customerProfileId: string): Promise<LoyaltyRecommendation[]> {
  const accounts = await prisma.loyaltyAccount.findMany({ where: { customerProfileId } });
  if (!accounts.length) return [];
  const businessIds = accounts.map((a) => a.businessId);
  const [businesses, programs, rewards, memberships, discountPlans] = await Promise.all([
    prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true, publicSlug: true } }),
    prisma.loyaltyProgram.findMany({ where: { businessId: { in: businessIds } } }),
    prisma.reward.findMany({ where: { businessId: { in: businessIds }, active: true, type: { not: "milestone" } }, orderBy: { pointsCost: "asc" } }),
    prisma.customerMembership.findMany({ where: { customerProfileId, status: "active" }, select: { businessId: true } }),
    prisma.membershipPlan.findMany({ where: { businessId: { in: businessIds }, active: true, discountPercent: { gt: 0 } }, orderBy: { discountPercent: "desc" } }),
  ]);
  const bizById = new Map(businesses.map((b) => [b.id, b]));
  const programById = new Map(programs.map((p) => [p.businessId, p]));
  const memberBiz = new Set(memberships.map((m) => m.businessId));

  const out: LoyaltyRecommendation[] = [];
  for (const account of accounts) {
    const business = bizById.get(account.businessId);
    if (!business) continue;
    const program = programById.get(account.businessId);

    // 1. Rewards within reach (<= 25% more points needed).
    const bizRewards = rewards.filter((r) => r.businessId === account.businessId);
    for (const reward of bizRewards) {
      const away = reward.pointsCost - account.pointsBalance;
      if (away <= 0) {
        out.push({ type: "redeem_now", businessId: business.id, businessName: business.name, slug: business.publicSlug, reason: `You have enough points to redeem "${reward.name}" (${reward.pointsCost} pts).`, pointsAway: 0 });
        break;
      }
      if (reward.pointsCost > 0 && away <= reward.pointsCost * 0.25) {
        out.push({ type: "reward_within_reach", businessId: business.id, businessName: business.name, slug: business.publicSlug, reason: `You're ${away} points from "${reward.name}" at ${business.name}.`, pointsAway: away });
        break;
      }
    }

    // 2. Tier upgrade.
    const upcoming = nextTier(account.lifetimePoints, program?.tierConfig ?? null);
    const current = resolveTier(account.lifetimePoints, program?.tierConfig ?? null);
    if (upcoming && upcoming.pointsAway <= 300) {
      out.push({ type: "tier_upgrade", businessId: business.id, businessName: business.name, slug: business.publicSlug, reason: `${upcoming.pointsAway} points from ${upcoming.tier.name} tier at ${business.name} (you're ${current.name} now).`, pointsAway: upcoming.pointsAway });
    }

    // 3. Membership savings for frequent visitors who are not members.
    if (!memberBiz.has(account.businessId)) {
      const plan = discountPlans.find((p) => p.businessId === account.businessId);
      const visits = await prisma.appointment.count({ where: { businessId: account.businessId, bookedByCustomerProfileId: customerProfileId, status: "COMPLETED" } });
      if (plan && visits >= 2) {
        out.push({ type: "membership_saves", businessId: business.id, businessName: business.name, slug: business.publicSlug, reason: `You've completed ${visits} bookings at ${business.name} — the "${plan.name}" membership gives ${plan.discountPercent}% off.`, savingsEstimate: plan.discountPercent });
      }
    }

    // 4. Expiring points.
    const expiring = await prisma.loyaltyTransaction.aggregate({
      where: { accountId: account.id, kind: "earn", expiredAt: null, expiresAt: { not: null, lt: new Date(Date.now() + 30 * 86_400_000) } },
      _sum: { points: true },
    });
    if ((expiring._sum.points ?? 0) > 0) {
      out.push({ type: "expiring_points", businessId: business.id, businessName: business.name, slug: business.publicSlug, reason: `${expiring._sum.points} points at ${business.name} expire within 30 days.`, pointsAway: 0 });
    }
  }
  return out;
}
