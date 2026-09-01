import { prisma } from "../prisma.js";

// PROGRAM 2 LOOP 5: loyalty program config + tier resolution. Per-business.

export interface LoyaltyTier {
  key: string;
  name: string;
  minPoints: number;
  perks: string[];
}

export const DEFAULT_TIERS: LoyaltyTier[] = [
  { key: "bronze", name: "Bronze", minPoints: 0, perks: [] },
  { key: "silver", name: "Silver", minPoints: 500, perks: ["Early access to promotions"] },
  { key: "gold", name: "Gold", minPoints: 1500, perks: ["Priority booking", "Birthday reward"] },
  { key: "platinum", name: "Platinum", minPoints: 4000, perks: ["Priority booking", "Exclusive rewards", "Dedicated support"] },
];

export function readTiers(tierConfig: unknown): LoyaltyTier[] {
  if (!Array.isArray(tierConfig) || !tierConfig.length) return DEFAULT_TIERS;
  return (tierConfig as LoyaltyTier[])
    .filter((tier) => tier && typeof tier.key === "string" && typeof tier.minPoints === "number")
    .map((tier) => ({ key: tier.key, name: tier.name ?? tier.key, minPoints: tier.minPoints, perks: Array.isArray(tier.perks) ? tier.perks : [] }))
    .sort((a, b) => a.minPoints - b.minPoints);
}

/** The highest tier whose threshold `lifetimePoints` meets. */
export function resolveTier(lifetimePoints: number, tierConfig: unknown): LoyaltyTier {
  const tiers = readTiers(tierConfig);
  let current: LoyaltyTier = tiers[0] ?? DEFAULT_TIERS[0]!;
  for (const tier of tiers) if (lifetimePoints >= tier.minPoints) current = tier;
  return current;
}

export function nextTier(lifetimePoints: number, tierConfig: unknown): { tier: LoyaltyTier; pointsAway: number } | null {
  const tiers = readTiers(tierConfig);
  const upcoming = tiers.find((tier) => tier.minPoints > lifetimePoints);
  return upcoming ? { tier: upcoming, pointsAway: upcoming.minPoints - lifetimePoints } : null;
}

export async function getLoyaltyProgram(businessId: string) {
  return prisma.loyaltyProgram.findUnique({ where: { businessId } });
}

export async function upsertLoyaltyProgram(
  businessId: string,
  actorUserId: string | null,
  patch: Partial<{
    active: boolean;
    pointsPerCurrency: number;
    pointsPerBookingBonus: number;
    pointsPerReview: number;
    pointsPerReferral: number;
    pointExpiryDays: number | null;
    currency: string | null;
    tierConfig: LoyaltyTier[] | null;
    welcomeBonus: number;
  }>,
) {
  return prisma.loyaltyProgram.upsert({
    where: { businessId },
    create: {
      businessId,
      createdByUserId: actorUserId,
      active: patch.active ?? true,
      pointsPerCurrency: patch.pointsPerCurrency ?? 1,
      pointsPerBookingBonus: patch.pointsPerBookingBonus ?? 0,
      pointsPerReview: patch.pointsPerReview ?? 0,
      pointsPerReferral: patch.pointsPerReferral ?? 0,
      pointExpiryDays: patch.pointExpiryDays ?? null,
      currency: patch.currency ?? null,
      tierConfig: (patch.tierConfig ?? undefined) as never,
      welcomeBonus: patch.welcomeBonus ?? 0,
    },
    update: {
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.pointsPerCurrency !== undefined ? { pointsPerCurrency: patch.pointsPerCurrency } : {}),
      ...(patch.pointsPerBookingBonus !== undefined ? { pointsPerBookingBonus: patch.pointsPerBookingBonus } : {}),
      ...(patch.pointsPerReview !== undefined ? { pointsPerReview: patch.pointsPerReview } : {}),
      ...(patch.pointsPerReferral !== undefined ? { pointsPerReferral: patch.pointsPerReferral } : {}),
      ...(patch.pointExpiryDays !== undefined ? { pointExpiryDays: patch.pointExpiryDays } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.tierConfig !== undefined ? { tierConfig: (patch.tierConfig ?? undefined) as never } : {}),
      ...(patch.welcomeBonus !== undefined ? { welcomeBonus: patch.welcomeBonus } : {}),
    },
  });
}
