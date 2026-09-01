import { randomBytes } from "node:crypto";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { recordCustomerActivity } from "../customer/customerContext.js";
import { getLoyaltyProgram, readTiers, resolveTier } from "./program.js";
import { redeemPoints, ensureLoyaltyAccount } from "./pointsEngine.js";
import { notifyLoyalty } from "./notifications.js";

// PROGRAM 2 LOOP 5: the reward catalog + redemptions. Businesses fully own
// the catalog. A redemption spends points (redeemPoints) and issues a code;
// applying it to a booking is informational discount metadata only — no
// charge is taken here.

const REWARD_TYPES = ["free_service", "percent_discount", "fixed_discount", "promo", "birthday", "milestone"] as const;
export type RewardType = (typeof REWARD_TYPES)[number];

function newCode(): string {
  return `RW-${randomBytes(4).toString("hex").toUpperCase()}`;
}

// --- Catalog (business-managed) ---------------------------------------------

export async function listRewards(businessId: string, activeOnly = false) {
  return prisma.reward.findMany({
    where: { businessId, ...(activeOnly ? { active: true } : {}) },
    orderBy: [{ active: "desc" }, { pointsCost: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
}

export async function createReward(businessId: string, actorUserId: string | null, input: {
  name: string; description?: string; type: RewardType; pointsCost?: number; value?: number; serviceOfferingId?: string;
  minTierKey?: string; autoGrant?: boolean; milestoneBookings?: number; membersOnly?: boolean; startsAt?: string; endsAt?: string; redemptionValidityDays?: number;
}) {
  if (!REWARD_TYPES.includes(input.type)) throw ApiError.badRequest("Unknown reward type");
  if (input.serviceOfferingId) {
    const service = await prisma.serviceOffering.findFirst({ where: { id: input.serviceOfferingId, businessId }, select: { id: true } });
    if (!service) throw ApiError.badRequest("serviceOfferingId is not a service of this business");
  }
  return prisma.reward.create({
    data: {
      businessId,
      createdByUserId: actorUserId,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      pointsCost: input.pointsCost ?? 0,
      value: input.value ?? null,
      serviceOfferingId: input.serviceOfferingId ?? null,
      minTierKey: input.minTierKey ?? null,
      autoGrant: input.autoGrant ?? false,
      milestoneBookings: input.milestoneBookings ?? null,
      membersOnly: input.membersOnly ?? false,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      redemptionValidityDays: input.redemptionValidityDays ?? null,
    },
  });
}

export async function updateReward(businessId: string, id: string, patch: Record<string, unknown>) {
  const existing = await prisma.reward.findFirst({ where: { id, businessId }, select: { id: true } });
  if (!existing) throw ApiError.notFound("Reward not found");
  const allowed = ["name", "description", "pointsCost", "value", "minTierKey", "autoGrant", "milestoneBookings", "membersOnly", "active", "redemptionValidityDays"] as const;
  const data: Record<string, unknown> = {};
  for (const key of allowed) if (patch[key] !== undefined) data[key] = patch[key];
  if (patch.startsAt !== undefined) data.startsAt = patch.startsAt ? new Date(patch.startsAt as string) : null;
  if (patch.endsAt !== undefined) data.endsAt = patch.endsAt ? new Date(patch.endsAt as string) : null;
  return prisma.reward.update({ where: { id }, data });
}

export async function deleteReward(businessId: string, id: string) {
  await prisma.reward.updateMany({ where: { id, businessId }, data: { active: false } });
  return { deactivated: id };
}

// --- Eligibility & redemption ---------------------------------------------

function rewardIsLive(reward: { active: boolean; startsAt: Date | null; endsAt: Date | null }, now = new Date()): boolean {
  return reward.active && (!reward.startsAt || reward.startsAt <= now) && (!reward.endsAt || reward.endsAt > now);
}

/** Rewards a customer can see for a business, each annotated with affordability + eligibility. */
export async function listAvailableRewards(businessId: string, customerProfileId: string) {
  const [program, account, rewards, membership] = await Promise.all([
    getLoyaltyProgram(businessId),
    prisma.loyaltyAccount.findUnique({ where: { businessId_customerProfileId: { businessId, customerProfileId } } }),
    prisma.reward.findMany({ where: { businessId, active: true }, orderBy: { pointsCost: "asc" } }),
    prisma.customerMembership.findFirst({ where: { businessId, customerProfileId, status: "active" }, select: { id: true } }),
  ]);
  const tiers = readTiers(program?.tierConfig ?? null);
  const tierRank = new Map(tiers.map((tier, index) => [tier.key, index]));
  const currentTier = resolveTier(account?.lifetimePoints ?? 0, program?.tierConfig ?? null);
  const balance = account?.pointsBalance ?? 0;

  return rewards
    .filter((reward) => rewardIsLive(reward))
    .map((reward) => {
      const tierOk = !reward.minTierKey || (tierRank.get(currentTier.key) ?? 0) >= (tierRank.get(reward.minTierKey) ?? 0);
      const memberOk = !reward.membersOnly || Boolean(membership);
      return {
        id: reward.id,
        name: reward.name,
        description: reward.description,
        type: reward.type,
        pointsCost: reward.pointsCost,
        value: reward.value,
        serviceOfferingId: reward.serviceOfferingId,
        minTierKey: reward.minTierKey,
        membersOnly: reward.membersOnly,
        affordable: balance >= reward.pointsCost,
        pointsShort: Math.max(0, reward.pointsCost - balance),
        tierEligible: tierOk,
        memberEligible: memberOk,
        redeemable: tierOk && memberOk && balance >= reward.pointsCost && reward.type !== "milestone",
      };
    });
}

export async function redeemReward(businessId: string, customerProfileId: string, rewardId: string) {
  const reward = await prisma.reward.findFirst({ where: { id: rewardId, businessId } });
  if (!reward) throw ApiError.notFound("Reward not found");
  if (!rewardIsLive(reward)) throw ApiError.conflict("This reward is not available right now");
  if (reward.type === "milestone") throw ApiError.conflict("Milestone rewards are granted automatically");

  const [program, account, membership] = await Promise.all([
    getLoyaltyProgram(businessId),
    prisma.loyaltyAccount.findUnique({ where: { businessId_customerProfileId: { businessId, customerProfileId } } }),
    prisma.customerMembership.findFirst({ where: { businessId, customerProfileId, status: "active" }, select: { id: true } }),
  ]);
  if (reward.membersOnly && !membership) throw ApiError.forbidden("This reward is for members only");
  if (reward.minTierKey) {
    const tiers = readTiers(program?.tierConfig ?? null);
    const rank = new Map(tiers.map((tier, index) => [tier.key, index]));
    const currentTier = resolveTier(account?.lifetimePoints ?? 0, program?.tierConfig ?? null);
    if ((rank.get(currentTier.key) ?? 0) < (rank.get(reward.minTierKey) ?? 0)) {
      throw ApiError.forbidden(`This reward needs ${reward.minTierKey} tier`);
    }
  }

  await ensureLoyaltyAccount(businessId, customerProfileId);
  const acct = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { businessId_customerProfileId: { businessId, customerProfileId } } });

  const code = newCode();
  const redemption = await prisma.rewardRedemption.create({
    data: {
      rewardId: reward.id,
      businessId,
      customerProfileId,
      accountId: acct.id,
      status: "issued",
      code,
      pointsSpent: reward.pointsCost,
      sourceType: "manual_redeem",
      sourceId: `${reward.id}:${Date.now()}`,
      expiresAt: reward.redemptionValidityDays ? new Date(Date.now() + reward.redemptionValidityDays * 86_400_000) : null,
    },
  });

  if (reward.pointsCost > 0) {
    try {
      await redeemPoints({ businessId, customerProfileId, points: reward.pointsCost, sourceType: "reward_redemption", sourceId: redemption.id, reason: `Redeemed "${reward.name}"`, rewardRedemptionId: redemption.id });
    } catch (error) {
      await prisma.rewardRedemption.update({ where: { id: redemption.id }, data: { status: "revoked", revokedReason: "point debit failed" } });
      throw error;
    }
  }

  await recordCustomerActivity({ customerProfileId, businessId, type: "LOYALTY_REWARD_REDEEMED", entityType: "reward_redemption", entityId: redemption.id, metadata: { reward: reward.name, pointsSpent: reward.pointsCost } });
  await notifyLoyalty(customerProfileId, businessId, "reward_unlocked", { reward: reward.name }).catch(() => undefined);
  return { id: redemption.id, code: redemption.code, status: redemption.status, reward: { name: reward.name, type: reward.type, value: reward.value }, pointsSpent: reward.pointsCost, expiresAt: redemption.expiresAt };
}

/** Auto-grants milestone rewards the customer has newly reached (idempotent per reward). */
export async function grantMilestoneRewards(businessId: string, customerProfileId: string) {
  const milestoneRewards = await prisma.reward.findMany({
    where: { businessId, active: true, type: "milestone", autoGrant: true, milestoneBookings: { not: null } },
  });
  if (!milestoneRewards.length) return [];

  const link = await prisma.customerBusinessLink.findFirst({ where: { businessId, customerProfileId }, select: { businessCustomerId: true } });
  const completed = link?.businessCustomerId
    ? await prisma.appointment.count({ where: { businessId, customerId: link.businessCustomerId, status: "COMPLETED" } })
    : await prisma.appointment.count({ where: { businessId, bookedByCustomerProfileId: customerProfileId, status: "COMPLETED" } });

  const granted: string[] = [];
  for (const reward of milestoneRewards) {
    if (completed < (reward.milestoneBookings ?? Infinity)) continue;
    try {
      const redemption = await prisma.rewardRedemption.create({
        data: {
          rewardId: reward.id, businessId, customerProfileId, status: "issued", code: newCode(), pointsSpent: 0,
          sourceType: "milestone", sourceId: reward.id,
          expiresAt: reward.redemptionValidityDays ? new Date(Date.now() + reward.redemptionValidityDays * 86_400_000) : null,
        },
      });
      granted.push(redemption.id);
      await notifyLoyalty(customerProfileId, businessId, "milestone", { label: reward.name }).catch(() => undefined);
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error; // already granted
    }
  }
  return granted;
}

export async function listMyRedemptions(customerProfileId: string, status?: string) {
  const rows = await prisma.rewardRedemption.findMany({
    where: { customerProfileId, ...(status ? { status } : {}) },
    orderBy: { issuedAt: "desc" },
    take: 100,
    include: { reward: { select: { name: true, type: true, value: true } } },
  });
  const businessIds = [...new Set(rows.map((r) => r.businessId))];
  const businesses = businessIds.length ? await prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true, publicSlug: true } }) : [];
  const byId = new Map(businesses.map((b) => [b.id, b]));
  return rows.map((r) => ({
    id: r.id, code: r.code, status: r.status, pointsSpent: r.pointsSpent, issuedAt: r.issuedAt, redeemedAt: r.redeemedAt, expiresAt: r.expiresAt,
    reward: r.reward, business: byId.get(r.businessId) ?? null,
  }));
}

export async function markRedemptionRedeemed(businessId: string, id: string, appointmentId?: string) {
  const redemption = await prisma.rewardRedemption.findFirst({ where: { id, businessId } });
  if (!redemption) throw ApiError.notFound("Redemption not found");
  if (redemption.status === "redeemed") return redemption;
  if (redemption.status !== "issued" && redemption.status !== "reserved") throw ApiError.conflict(`Cannot redeem a ${redemption.status} reward`);
  if (redemption.expiresAt && redemption.expiresAt < new Date()) {
    await prisma.rewardRedemption.update({ where: { id }, data: { status: "expired" } });
    throw ApiError.conflict("This reward has expired");
  }
  return prisma.rewardRedemption.update({ where: { id }, data: { status: "redeemed", redeemedAt: new Date(), appointmentId: appointmentId ?? redemption.appointmentId } });
}

export async function revokeRedemption(businessId: string, id: string, reason: string, refundPoints = true) {
  const redemption = await prisma.rewardRedemption.findFirst({ where: { id, businessId } });
  if (!redemption) throw ApiError.notFound("Redemption not found");
  if (redemption.status === "redeemed") throw ApiError.conflict("A redeemed reward cannot be revoked");
  await prisma.rewardRedemption.update({ where: { id }, data: { status: "revoked", revokedReason: reason } });
  if (refundPoints && redemption.pointsSpent > 0) {
    const { adjustPoints } = await import("./pointsEngine.js");
    await adjustPoints({ businessId, customerProfileId: redemption.customerProfileId, points: redemption.pointsSpent, sourceType: "reward_refund", sourceId: redemption.id, reason: `Refund: ${reason}` }).catch(() => undefined);
  }
  return { revoked: true };
}
