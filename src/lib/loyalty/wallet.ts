import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { getLoyaltyProgram, resolveTier, nextTier, readTiers } from "./program.js";
import { listAvailableRewards } from "./rewards.js";
import { myReferrals } from "./referrals.js";

// PROGRAM 2 LOOP 5: the read-only customer wallet — points balance,
// membership status, reward balance and transaction history, aggregated
// across every business. Foundation only: no stored-value cash.

export async function getLoyaltyAccountSummary(customerProfileId: string, businessId: string) {
  const [program, account, business] = await Promise.all([
    getLoyaltyProgram(businessId),
    prisma.loyaltyAccount.findUnique({ where: { businessId_customerProfileId: { businessId, customerProfileId } } }),
    prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, publicSlug: true } }),
  ]);
  if (!business) throw ApiError.notFound("Business not found");
  const lifetime = account?.lifetimePoints ?? 0;
  const tier = resolveTier(lifetime, program?.tierConfig ?? null);
  const upcoming = nextTier(lifetime, program?.tierConfig ?? null);
  const rewards = await listAvailableRewards(businessId, customerProfileId);
  return {
    business,
    enrolled: Boolean(account),
    programActive: Boolean(program?.active),
    pointsBalance: account?.pointsBalance ?? 0,
    lifetimePoints: lifetime,
    tier: { key: tier.key, name: tier.name, perks: tier.perks },
    nextTier: upcoming ? { key: upcoming.tier.key, name: upcoming.tier.name, pointsAway: upcoming.pointsAway } : null,
    allTiers: readTiers(program?.tierConfig ?? null),
    availableRewards: rewards,
    pointExpiryDays: program?.pointExpiryDays ?? null,
  };
}

export async function listLoyaltyTransactions(customerProfileId: string, businessId: string, query: { cursor?: string; limit?: number } = {}) {
  const account = await prisma.loyaltyAccount.findUnique({ where: { businessId_customerProfileId: { businessId, customerProfileId } }, select: { id: true } });
  if (!account) return { items: [], nextCursor: null };
  const limit = Math.min(query.limit ?? 25, 100);
  const rows = await prisma.loyaltyTransaction.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: { id: true, kind: true, points: true, balanceAfter: true, reason: true, sourceType: true, sourceId: true, expiresAt: true, createdAt: true },
  });
  const items = rows.slice(0, limit);
  return { items, nextCursor: rows.length > limit ? items[items.length - 1]?.id ?? null : null };
}

export async function getWallet(customerProfileId: string) {
  const [accounts, memberships, redemptions, referrals] = await Promise.all([
    prisma.loyaltyAccount.findMany({ where: { customerProfileId }, orderBy: { lastActivityAt: "desc" } }),
    prisma.customerMembership.findMany({ where: { customerProfileId }, include: { plan: { select: { name: true, discountPercent: true, priorityBooking: true, priceAmount: true, currency: true } } } }),
    prisma.rewardRedemption.findMany({ where: { customerProfileId }, orderBy: { issuedAt: "desc" }, take: 50, include: { reward: { select: { name: true, type: true } } } }),
    myReferrals(customerProfileId),
  ]);

  const businessIds = [...new Set([...accounts.map((a) => a.businessId), ...memberships.map((m) => m.businessId), ...redemptions.map((r) => r.businessId)])];
  const businesses = businessIds.length ? await prisma.business.findMany({ where: { id: { in: businessIds } }, select: { id: true, name: true, publicSlug: true } }) : [];
  const byId = new Map(businesses.map((b) => [b.id, b]));
  const programs = businessIds.length ? await prisma.loyaltyProgram.findMany({ where: { businessId: { in: businessIds } } }) : [];
  const programById = new Map(programs.map((p) => [p.businessId, p]));

  const recentTransactions = accounts.length
    ? await prisma.loyaltyTransaction.findMany({
        where: { accountId: { in: accounts.map((a) => a.id) } },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: { id: true, businessId: true, kind: true, points: true, balanceAfter: true, reason: true, createdAt: true },
      })
    : [];

  return {
    totalPoints: accounts.reduce((sum, a) => sum + a.pointsBalance, 0),
    lifetimePoints: accounts.reduce((sum, a) => sum + a.lifetimePoints, 0),
    accounts: accounts.map((a) => {
      const program = programById.get(a.businessId);
      const tier = resolveTier(a.lifetimePoints, program?.tierConfig ?? null);
      return {
        businessId: a.businessId,
        business: byId.get(a.businessId) ?? null,
        pointsBalance: a.pointsBalance,
        lifetimePoints: a.lifetimePoints,
        tier: { key: tier.key, name: tier.name },
        lastActivityAt: a.lastActivityAt,
      };
    }),
    memberships: memberships.map((m) => ({
      id: m.id, businessId: m.businessId, business: byId.get(m.businessId) ?? null, status: m.status, billingInterval: m.billingInterval,
      currentPeriodEnd: m.currentPeriodEnd, cancelAtPeriodEnd: m.cancelAtPeriodEnd,
      plan: { name: m.plan.name, discountPercent: m.plan.discountPercent, priorityBooking: m.plan.priorityBooking, priceAmount: m.plan.priceAmount, currency: m.plan.currency },
    })),
    activeMemberships: memberships.filter((m) => m.status === "active").length,
    rewards: {
      issued: redemptions.filter((r) => r.status === "issued" || r.status === "reserved").length,
      redeemed: redemptions.filter((r) => r.status === "redeemed").length,
      list: redemptions.map((r) => ({ id: r.id, code: r.code, status: r.status, businessId: r.businessId, business: byId.get(r.businessId) ?? null, reward: r.reward, issuedAt: r.issuedAt, expiresAt: r.expiresAt })),
    },
    referrals: referrals.summary,
    recentTransactions: recentTransactions.map((t) => ({ ...t, business: byId.get(t.businessId) ?? null })),
    generatedAt: new Date().toISOString(),
  };
}
