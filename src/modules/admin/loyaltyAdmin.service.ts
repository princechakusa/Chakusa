import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { loyaltyPlatformAnalytics, loyaltyFraudReview } from "../loyalty/loyaltyAnalytics.js";
import { adjustPoints } from "../../lib/loyalty/pointsEngine.js";
import { revokeRedemption } from "../../lib/loyalty/rewards.js";

// PROGRAM 2 LOOP 5: platform loyalty oversight. Reads the loyalty cluster;
// mutations delegate to the shared engine. RBAC (loyalty.read /
// loyalty.manage) + CSRF + audit live on the admin router.

export { loyaltyPlatformAnalytics as adminLoyaltyAnalytics, loyaltyFraudReview as adminLoyaltyFraudReview };

function pageArgs(p = 1, size = 25) {
  const take = Math.min(200, Math.max(1, size));
  return { skip: (Math.max(1, p) - 1) * take, take, page: Math.max(1, p), pageSize: take };
}

export async function adminLoyaltyPrograms(query: { page?: number; pageSize?: number }) {
  const { skip, take, page, pageSize } = pageArgs(query.page, query.pageSize);
  const [rows, total] = await Promise.all([
    prisma.loyaltyProgram.findMany({ orderBy: { updatedAt: "desc" }, skip, take }),
    prisma.loyaltyProgram.count(),
  ]);
  const businessIds = rows.map((r) => r.businessId);
  const [businesses, accountCounts] = await Promise.all([
    businessIds.length ? prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true, publicSlug: true } }) : [],
    businessIds.length ? prisma.loyaltyAccount.groupBy({ by: ["businessId"], where: { businessId: { in: businessIds } }, _count: { _all: true } }) : [],
  ]);
  const nameBy = new Map(businesses.map((b) => [b.id, b]));
  const countBy = new Map(accountCounts.map((c) => [c.businessId, c._count._all]));
  return { items: rows.map((r) => ({ ...r, business: nameBy.get(r.businessId) ?? null, members: countBy.get(r.businessId) ?? 0 })), total, page, pageSize };
}

export async function adminLoyaltyMemberships(query: { status?: string; page?: number; pageSize?: number }) {
  const { skip, take, page, pageSize } = pageArgs(query.page, query.pageSize);
  const where = query.status ? { status: query.status } : {};
  const [items, total] = await Promise.all([
    prisma.customerMembership.findMany({ where, orderBy: { startedAt: "desc" }, skip, take, include: { plan: { select: { name: true, priceAmount: true, billingInterval: true } } } }),
    prisma.customerMembership.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function adminLoyaltyRewards(query: { page?: number; pageSize?: number }) {
  const { skip, take, page, pageSize } = pageArgs(query.page, query.pageSize);
  const [items, total] = await Promise.all([
    prisma.reward.findMany({ orderBy: { createdAt: "desc" }, skip, take }),
    prisma.reward.count(),
  ]);
  return { items, total, page, pageSize };
}

export async function adminLoyaltyRedemptions(query: { status?: string; page?: number; pageSize?: number }) {
  const { skip, take, page, pageSize } = pageArgs(query.page, query.pageSize);
  const where = query.status ? { status: query.status } : {};
  const [items, total] = await Promise.all([
    prisma.rewardRedemption.findMany({ where, orderBy: { issuedAt: "desc" }, skip, take, include: { reward: { select: { name: true, type: true } } } }),
    prisma.rewardRedemption.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function adminLoyaltyReferrals(query: { status?: string; page?: number; pageSize?: number }) {
  const { skip, take, page, pageSize } = pageArgs(query.page, query.pageSize);
  const where = query.status ? { status: query.status } : {};
  const [items, total] = await Promise.all([
    prisma.referral.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
    prisma.referral.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function adminLoyaltyCampaigns(query: { activeOnly?: boolean; page?: number; pageSize?: number }) {
  const { skip, take, page, pageSize } = pageArgs(query.page, query.pageSize);
  const where = query.activeOnly ? { active: true, endsAt: { gt: new Date() } } : {};
  const [items, total] = await Promise.all([
    prisma.loyaltyCampaign.findMany({ where, orderBy: { startsAt: "desc" }, skip, take }),
    prisma.loyaltyCampaign.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function adminRevokeLoyaltyTransaction(id: string, reason: string, actorUserId: string) {
  const txn = await prisma.loyaltyTransaction.findUnique({ where: { id }, include: { account: { select: { businessId: true, customerProfileId: true } } } });
  if (!txn) throw ApiError.notFound("Transaction not found");
  if (txn.kind !== "earn" && txn.kind !== "adjust") throw ApiError.conflict("Only an earn/adjust transaction can be reversed");
  return adjustPoints({
    businessId: txn.account.businessId,
    customerProfileId: txn.account.customerProfileId,
    points: -txn.points,
    sourceType: "admin_reversal",
    sourceId: txn.id,
    reason: `Reversed by platform: ${reason}`,
    createdByUserId: actorUserId,
    allowNegativeBalance: true,
  });
}

export async function adminRevokeRedemption(id: string, reason: string) {
  const redemption = await prisma.rewardRedemption.findUnique({ where: { id }, select: { businessId: true } });
  if (!redemption) throw ApiError.notFound("Redemption not found");
  return revokeRedemption(redemption.businessId, id, `Platform review: ${reason}`, true);
}
