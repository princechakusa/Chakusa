import { prisma } from "../../lib/prisma.js";

// PROGRAM 2 LOOP 5: loyalty analytics — one business-scoped, one
// platform-wide (reused by the admin surface).

export async function loyaltyBusinessAnalytics(businessId: string) {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [program, accounts, tierBreakdown, pointsAgg, earn30, redeem30, redemptions, memberships, campaigns] = await Promise.all([
    prisma.loyaltyProgram.findUnique({ where: { businessId } }),
    prisma.loyaltyAccount.count({ where: { businessId } }),
    prisma.loyaltyAccount.groupBy({ by: ["tierKey"], where: { businessId }, _count: { _all: true } }),
    prisma.loyaltyAccount.aggregate({ where: { businessId }, _sum: { pointsBalance: true, lifetimePoints: true } }),
    prisma.loyaltyTransaction.aggregate({ where: { businessId, kind: "earn", createdAt: { gte: since30 } }, _sum: { points: true }, _count: { _all: true } }),
    prisma.loyaltyTransaction.aggregate({ where: { businessId, kind: "redeem", createdAt: { gte: since30 } }, _sum: { points: true }, _count: { _all: true } }),
    prisma.rewardRedemption.groupBy({ by: ["status"], where: { businessId }, _count: { _all: true } }),
    prisma.customerMembership.groupBy({ by: ["status"], where: { businessId }, _count: { _all: true } }),
    prisma.loyaltyCampaign.count({ where: { businessId, active: true, endsAt: { gt: new Date() } } }),
  ]);
  return {
    programActive: Boolean(program?.active),
    members: accounts,
    tierBreakdown: Object.fromEntries(tierBreakdown.map((t) => [t.tierKey ?? "bronze", t._count._all])),
    outstandingPoints: pointsAgg._sum.pointsBalance ?? 0,
    lifetimePointsIssued: pointsAgg._sum.lifetimePoints ?? 0,
    last30Days: {
      pointsEarned: earn30._sum.points ?? 0,
      earnEvents: earn30._count._all,
      pointsRedeemed: Math.abs(redeem30._sum.points ?? 0),
      redeemEvents: redeem30._count._all,
    },
    redemptions: Object.fromEntries(redemptions.map((r) => [r.status, r._count._all])),
    memberships: Object.fromEntries(memberships.map((m) => [m.status, m._count._all])),
    activeCampaigns: campaigns,
  };
}

export async function loyaltyPlatformAnalytics() {
  const since30 = new Date(Date.now() - 30 * 86_400_000);
  const [programs, activePrograms, accounts, enrolledCustomers, pointsAgg, earn30, redeem30, redemptionStatus, membershipStatus, referralStatus, businessesWithProgram] = await Promise.all([
    prisma.loyaltyProgram.count(),
    prisma.loyaltyProgram.count({ where: { active: true } }),
    prisma.loyaltyAccount.count(),
    prisma.loyaltyAccount.groupBy({ by: ["customerProfileId"] }).then((rows) => rows.length),
    prisma.loyaltyAccount.aggregate({ _sum: { pointsBalance: true, lifetimePoints: true } }),
    prisma.loyaltyTransaction.aggregate({ where: { kind: "earn", createdAt: { gte: since30 } }, _sum: { points: true }, _count: { _all: true } }),
    prisma.loyaltyTransaction.aggregate({ where: { kind: "redeem", createdAt: { gte: since30 } }, _sum: { points: true }, _count: { _all: true } }),
    prisma.rewardRedemption.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.customerMembership.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.referral.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.loyaltyProgram.groupBy({ by: ["businessId"], where: { active: true } }).then((rows) => rows.length),
  ]);
  return {
    programs,
    activePrograms,
    businessesWithActiveProgram: businessesWithProgram,
    loyaltyAccounts: accounts,
    enrolledCustomers,
    outstandingPoints: pointsAgg._sum.pointsBalance ?? 0,
    lifetimePointsIssued: pointsAgg._sum.lifetimePoints ?? 0,
    last30Days: {
      pointsEarned: earn30._sum.points ?? 0,
      earnEvents: earn30._count._all,
      pointsRedeemed: Math.abs(redeem30._sum.points ?? 0),
      redeemEvents: redeem30._count._all,
    },
    redemptions: Object.fromEntries(redemptionStatus.map((r) => [r.status, r._count._all])),
    memberships: Object.fromEntries(membershipStatus.map((m) => [m.status, m._count._all])),
    referrals: Object.fromEntries(referralStatus.map((r) => [r.status, r._count._all])),
  };
}

/**
 * Heuristic fraud review — surfaces accounts / referrers whose pattern is
 * worth a human look. No automated action is taken.
 */
export async function loyaltyFraudReview() {
  const since7 = new Date(Date.now() - 7 * 86_400_000);
  const [rapidRedeemers, negativeBalances, selfReferralAttempts, highVolumeReferrers] = await Promise.all([
    prisma.rewardRedemption.groupBy({
      by: ["customerProfileId"],
      where: { issuedAt: { gte: since7 } },
      _count: { _all: true },
      having: { customerProfileId: { _count: { gt: 5 } } },
    }),
    prisma.loyaltyAccount.findMany({ where: { pointsBalance: { lt: 0 } }, select: { id: true, businessId: true, customerProfileId: true, pointsBalance: true }, take: 100 }),
    prisma.referral.count({ where: { status: "rejected" } }),
    prisma.referral.groupBy({
      by: ["referrerProfileId"],
      where: { createdAt: { gte: since7 } },
      _count: { _all: true },
      having: { referrerProfileId: { _count: { gt: 10 } } },
    }),
  ]);
  return {
    rapidRedeemers: rapidRedeemers.map((r) => ({ customerProfileId: r.customerProfileId, redemptions7d: r._count._all })),
    negativeBalanceAccounts: negativeBalances,
    rejectedReferrals: selfReferralAttempts,
    highVolumeReferrers: highVolumeReferrers.map((r) => ({ referrerProfileId: r.referrerProfileId, referrals7d: r._count._all })),
  };
}
