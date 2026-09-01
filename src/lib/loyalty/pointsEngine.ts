import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { recordCustomerActivity } from "../customer/customerContext.js";
import { getLoyaltyProgram, resolveTier } from "./program.js";
import { notifyLoyalty } from "./notifications.js";

// PROGRAM 2 LOOP 5: the points engine. Every balance change is one atomic
// transaction that writes an append-only LoyaltyTransaction row and updates
// the account. Idempotency is the (accountId, sourceType, sourceId, kind)
// unique constraint — an earn from appointment X can be attempted many times
// and only ever lands once. Manual adjusts carry NULL source, so Postgres
// treats each as distinct and they always insert.

export type LoyaltyTxnKind = "earn" | "redeem" | "expire" | "adjust" | "revoke";

export async function ensureLoyaltyAccount(businessId: string, customerProfileId: string) {
  return prisma.loyaltyAccount.upsert({
    where: { businessId_customerProfileId: { businessId, customerProfileId } },
    create: { businessId, customerProfileId, enrolledAt: new Date() },
    update: {},
  });
}

interface MutateInput {
  businessId: string;
  customerProfileId: string;
  points: number; // positive magnitude
  kind: LoyaltyTxnKind;
  sourceType?: string | null;
  sourceId?: string | null;
  reason?: string | null;
  rewardRedemptionId?: string | null;
  campaignId?: string | null;
  expiresAt?: Date | null;
  createdByUserId?: string | null;
  allowNegativeBalance?: boolean;
}

interface MutateResult {
  applied: boolean;
  replayed: boolean;
  transactionId?: string;
  balanceAfter: number;
  lifetimePoints: number;
  tierKey: string;
  tierChanged: boolean;
}

async function mutate(input: MutateInput): Promise<MutateResult> {
  const signed = input.kind === "earn" ? Math.abs(input.points) : -Math.abs(input.points);
  const account = await ensureLoyaltyAccount(input.businessId, input.customerProfileId);
  const program = await getLoyaltyProgram(input.businessId);

  try {
    return await prisma.$transaction(async (tx) => {
      const current = await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } });
      if (signed < 0 && !input.allowNegativeBalance && current.pointsBalance + signed < 0) {
        throw ApiError.conflict("Not enough points for this operation");
      }
      const balanceAfter = current.pointsBalance + signed;
      const lifetimePoints = input.kind === "earn" ? current.lifetimePoints + Math.abs(input.points) : current.lifetimePoints;
      const tier = resolveTier(lifetimePoints, program?.tierConfig ?? null);
      const tierChanged = current.tierKey !== tier.key;

      const txn = await tx.loyaltyTransaction.create({
        data: {
          accountId: account.id,
          businessId: input.businessId,
          kind: input.kind,
          points: signed,
          balanceAfter,
          reason: input.reason ?? null,
          sourceType: input.sourceType ?? null,
          sourceId: input.sourceId ?? null,
          rewardRedemptionId: input.rewardRedemptionId ?? null,
          campaignId: input.campaignId ?? null,
          expiresAt: input.expiresAt ?? null,
          createdByUserId: input.createdByUserId ?? null,
        },
      });
      await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: { pointsBalance: balanceAfter, lifetimePoints, tierKey: tier.key, lastActivityAt: new Date() },
      });
      return { applied: true, replayed: false, transactionId: txn.id, balanceAfter, lifetimePoints, tierKey: tier.key, tierChanged };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      // Idempotent replay — the same (account, sourceType, sourceId, kind) already landed.
      const existing = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: account.id } });
      return { applied: false, replayed: true, balanceAfter: existing.pointsBalance, lifetimePoints: existing.lifetimePoints, tierKey: existing.tierKey ?? "bronze", tierChanged: false };
    }
    throw error;
  }
}

/** Awards points. Idempotent per (source). Fires a best-effort notification + activity. */
export async function earnPoints(input: Omit<MutateInput, "kind"> & { silent?: boolean }): Promise<MutateResult> {
  if (input.points <= 0) return { applied: false, replayed: false, balanceAfter: 0, lifetimePoints: 0, tierKey: "bronze", tierChanged: false };
  const result = await mutate({ ...input, kind: "earn" });
  if (result.applied && !input.silent) {
    await recordCustomerActivity({ customerProfileId: input.customerProfileId, businessId: input.businessId, type: "LOYALTY_POINTS_EARNED", entityType: input.sourceType ?? "loyalty", entityId: input.sourceId ?? result.transactionId, metadata: { points: input.points, reason: input.reason } }).catch(() => undefined);
    await notifyLoyalty(input.customerProfileId, input.businessId, "points_earned", { points: input.points, balance: result.balanceAfter }).catch(() => undefined);
    if (result.tierChanged) {
      await notifyLoyalty(input.customerProfileId, input.businessId, "tier_up", { tier: result.tierKey }).catch(() => undefined);
      await recordCustomerActivity({ customerProfileId: input.customerProfileId, businessId: input.businessId, type: "LOYALTY_TIER_CHANGED", entityType: "loyalty", entityId: result.transactionId, metadata: { tier: result.tierKey } }).catch(() => undefined);
    }
  }
  return result;
}

/** Spends points. Throws INSUFFICIENT_POINTS when the balance would go negative. */
export async function redeemPoints(input: Omit<MutateInput, "kind">): Promise<MutateResult> {
  return mutate({ ...input, kind: "redeem" });
}

/** A signed manual correction by the business or platform. `points` may be +/-. */
export async function adjustPoints(input: Omit<MutateInput, "kind" | "points"> & { points: number }): Promise<MutateResult> {
  const kind: LoyaltyTxnKind = input.points >= 0 ? "adjust" : "revoke";
  const result = await mutate({ ...input, points: Math.abs(input.points), kind, allowNegativeBalance: kind === "revoke" ? true : input.allowNegativeBalance });
  await recordCustomerActivity({ customerProfileId: input.customerProfileId, businessId: input.businessId, type: "LOYALTY_POINTS_ADJUSTED", entityType: "loyalty", entityId: result.transactionId, metadata: { points: input.points, reason: input.reason } }).catch(() => undefined);
  return result;
}

/**
 * Expires points whose `expiresAt` has passed and that have not been spent.
 * Deterministic: for each account, the still-unexpired earn rows past their
 * date are summed and a single `expire` transaction removes what remains of
 * the balance attributable to them (never more than the current balance).
 */
export async function expireDuePoints(businessId?: string, now = new Date()): Promise<{ accountsAffected: number; pointsExpired: number }> {
  const due = await prisma.loyaltyTransaction.findMany({
    where: { ...(businessId ? { businessId } : {}), kind: "earn", expiresAt: { not: null, lt: now }, expiredAt: null },
    select: { id: true, accountId: true, points: true, businessId: true },
  });
  if (!due.length) return { accountsAffected: 0, pointsExpired: 0 };

  const byAccount = new Map<string, { businessId: string; ids: string[]; total: number }>();
  for (const row of due) {
    const entry = byAccount.get(row.accountId) ?? { businessId: row.businessId, ids: [], total: 0 };
    entry.ids.push(row.id);
    entry.total += row.points;
    byAccount.set(row.accountId, entry);
  }

  let pointsExpired = 0;
  let accountsAffected = 0;
  for (const [accountId, entry] of byAccount) {
    await prisma.$transaction(async (tx) => {
      const account = await tx.loyaltyAccount.findUniqueOrThrow({ where: { id: accountId } });
      const toExpire = Math.min(account.pointsBalance, entry.total);
      await tx.loyaltyTransaction.updateMany({ where: { id: { in: entry.ids } }, data: { expiredAt: now } });
      if (toExpire > 0) {
        const balanceAfter = account.pointsBalance - toExpire;
        await tx.loyaltyTransaction.create({
          data: { accountId, businessId: entry.businessId, kind: "expire", points: -toExpire, balanceAfter, reason: `${entry.ids.length} point batch(es) expired`, sourceType: "expiry", sourceId: `${now.toISOString().slice(0, 10)}:${accountId}` },
        });
        await tx.loyaltyAccount.update({ where: { id: accountId }, data: { pointsBalance: balanceAfter } });
        pointsExpired += toExpire;
      }
      accountsAffected += 1;
    });
    const account = await prisma.loyaltyAccount.findUnique({ where: { id: accountId }, select: { customerProfileId: true, pointsBalance: true } });
    if (account) await notifyLoyalty(account.customerProfileId, entry.businessId, "points_expired", { balance: account.pointsBalance }).catch(() => undefined);
  }
  return { accountsAffected, pointsExpired };
}

export function loyaltyTransactionWhere(accountId: string): Prisma.LoyaltyTransactionWhereInput {
  return { accountId };
}
