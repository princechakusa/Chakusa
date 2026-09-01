import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";

// PROGRAM 2 LOOP 5: business-run, time-boxed points boosts.

export async function activeCampaignFor(businessId: string, at = new Date()) {
  return prisma.loyaltyCampaign.findFirst({
    where: { businessId, active: true, startsAt: { lte: at }, endsAt: { gt: at } },
    orderBy: { startsAt: "desc" },
  });
}

/** Applies the active campaign to a base points amount. Returns the boosted total + a breakdown. */
export function applyCampaign(basePoints: number, campaign: { kind: string; multiplier: number; bonusPoints: number } | null) {
  if (!campaign || basePoints <= 0) return { total: basePoints, multiplier: 1, bonus: 0 };
  const multiplier = campaign.kind === "multiplier" || campaign.kind === "bonus_points" ? Math.max(1, campaign.multiplier || 1) : 1;
  const bonus = campaign.kind === "bonus_points" || campaign.kind === "multiplier" ? Math.max(0, campaign.bonusPoints || 0) : 0;
  return { total: Math.round(basePoints * multiplier) + bonus, multiplier, bonus };
}

export async function listCampaigns(businessId: string, activeOnly = false) {
  return prisma.loyaltyCampaign.findMany({
    where: { businessId, ...(activeOnly ? { active: true } : {}) },
    orderBy: { startsAt: "desc" },
    take: 200,
  });
}

export async function createCampaign(businessId: string, actorUserId: string | null, input: {
  name: string; description?: string; kind?: string; multiplier?: number; bonusPoints?: number; rewardId?: string; startsAt: string; endsAt: string;
}) {
  if (new Date(input.endsAt) <= new Date(input.startsAt)) throw ApiError.badRequest("endsAt must be after startsAt");
  return prisma.loyaltyCampaign.create({
    data: {
      businessId,
      createdByUserId: actorUserId,
      name: input.name,
      description: input.description ?? null,
      kind: input.kind ?? "multiplier",
      multiplier: input.multiplier ?? 1,
      bonusPoints: input.bonusPoints ?? 0,
      rewardId: input.rewardId ?? null,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
    },
  });
}

export async function updateCampaign(businessId: string, id: string, patch: Partial<{ name: string; description: string | null; multiplier: number; bonusPoints: number; active: boolean; startsAt: string; endsAt: string }>) {
  const existing = await prisma.loyaltyCampaign.findFirst({ where: { id, businessId }, select: { id: true } });
  if (!existing) throw ApiError.notFound("Campaign not found");
  return prisma.loyaltyCampaign.update({
    where: { id },
    data: {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.multiplier !== undefined ? { multiplier: patch.multiplier } : {}),
      ...(patch.bonusPoints !== undefined ? { bonusPoints: patch.bonusPoints } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.startsAt !== undefined ? { startsAt: new Date(patch.startsAt) } : {}),
      ...(patch.endsAt !== undefined ? { endsAt: new Date(patch.endsAt) } : {}),
    },
  });
}

export async function deleteCampaign(businessId: string, id: string) {
  const deleted = await prisma.loyaltyCampaign.deleteMany({ where: { id, businessId } });
  if (!deleted.count) throw ApiError.notFound("Campaign not found");
  return { deleted: true };
}
