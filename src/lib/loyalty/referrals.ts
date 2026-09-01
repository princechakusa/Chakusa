import { randomBytes } from "node:crypto";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { config } from "../config.js";
import { recordCustomerActivity } from "../customer/customerContext.js";
import { earnPoints } from "./pointsEngine.js";
import { getLoyaltyProgram } from "./program.js";
import { notifyLoyalty } from "./notifications.js";

// PROGRAM 2 LOOP 5: referral codes, invite links and tracking. A customer's
// code is stable per (customer, business|null). A referral is created when a
// referee applies the code, and completes on the referee's first booking —
// at which point both sides get their configured points/reward.

function newReferralCode(name: string): string {
  const slug = name.replace(/[^A-Za-z]/g, "").slice(0, 6).toUpperCase() || "CHAK";
  return `${slug}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function getOrCreateReferralCode(customerProfileId: string, businessId: string | null): Promise<{ id: string; code: string; businessId: string | null; uses: number; inviteUrl: string }> {
  const existing = await prisma.referralCode.findFirst({
    where: { customerProfileId, businessId: businessId ?? null },
  });
  const profile = existing
    ? null
    : await prisma.customerProfile.findUniqueOrThrow({ where: { id: customerProfileId }, select: { displayName: true, user: { select: { fullName: true } } } });
  let program: { pointsPerReferral: number } | null = null;
  if (!existing && businessId) program = await getLoyaltyProgram(businessId);

  const code = existing
    ?? (await prisma.referralCode.create({
      data: {
        customerProfileId,
        businessId,
        code: newReferralCode(profile!.displayName ?? profile!.user.fullName),
        referrerPoints: program?.pointsPerReferral ?? 0,
        refereePoints: 0,
      },
    }));
  const base = config.PUBLIC_REVIEW_BASE_URL?.replace(/\/$/, "") ?? "https://chakusa.app";
  return { id: code.id, code: code.code, businessId: code.businessId, uses: code.uses, inviteUrl: `${base}/invite/${code.code}` };
}

/** A referee applies a code (from an invite link). Creates a pending referral. */
export async function redeemReferralCode(refereeProfileId: string, rawCode: string) {
  const code = await prisma.referralCode.findUnique({ where: { code: rawCode.trim().toUpperCase() } });
  if (!code || !code.active) throw ApiError.notFound("Referral code not found");
  if (code.customerProfileId === refereeProfileId) throw ApiError.conflict("You cannot use your own referral code");
  if (code.maxUses != null && code.uses >= code.maxUses) throw ApiError.conflict("This referral code has been used up");

  const existing = await prisma.referral.findUnique({ where: { codeId_refereeProfileId: { codeId: code.id, refereeProfileId } } });
  if (existing) return { referralId: existing.id, status: existing.status };

  // A profile can only be referred once, ever (first code wins).
  const alreadyReferred = await prisma.referral.findFirst({ where: { refereeProfileId, status: { in: ["joined", "completed"] } }, select: { id: true } });
  if (alreadyReferred) throw ApiError.conflict("This account has already used a referral");

  const referral = await prisma.referral.create({
    data: { codeId: code.id, businessId: code.businessId, referrerProfileId: code.customerProfileId, refereeProfileId, status: "joined", joinedAt: new Date() },
  });
  await prisma.referralCode.update({ where: { id: code.id }, data: { uses: { increment: 1 } } });
  await recordCustomerActivity({ customerProfileId: code.customerProfileId, businessId: code.businessId, type: "REFERRAL_JOINED", entityType: "referral", entityId: referral.id });
  return { referralId: referral.id, status: referral.status };
}

/** Completes a joined referral when the referee makes their first booking; grants both sides. */
export async function completeReferralOnFirstBooking(refereeProfileId: string, appointmentId: string, businessId: string) {
  const referral = await prisma.referral.findFirst({
    where: { refereeProfileId, status: "joined" },
    include: { code: true },
  });
  if (!referral) return null;

  // First booking only.
  const priorBookings = await prisma.appointment.count({ where: { bookedByCustomerProfileId: refereeProfileId, id: { not: appointmentId } } });
  if (priorBookings > 0) return null;

  const now = new Date();
  const updated = await prisma.referral.update({
    where: { id: referral.id },
    data: { status: "completed", completedAt: now, firstBookingId: appointmentId },
  });

  const refBusinessId = referral.businessId ?? businessId;
  // Grant points to both sides (idempotent per referral id + role).
  if (referral.code.referrerPoints > 0) {
    await earnPoints({ businessId: refBusinessId, customerProfileId: referral.referrerProfileId, points: referral.code.referrerPoints, sourceType: "referral", sourceId: `${referral.id}:referrer`, reason: "Referral completed" }).catch(() => undefined);
    await prisma.referral.update({ where: { id: referral.id }, data: { rewardedReferrerAt: now } }).catch(() => undefined);
  }
  if (referral.code.refereePoints > 0 && referral.refereeProfileId) {
    await earnPoints({ businessId: refBusinessId, customerProfileId: referral.refereeProfileId, points: referral.code.refereePoints, sourceType: "referral", sourceId: `${referral.id}:referee`, reason: "Welcome referral bonus" }).catch(() => undefined);
    await prisma.referral.update({ where: { id: referral.id }, data: { rewardedRefereeAt: now } }).catch(() => undefined);
  }

  await recordCustomerActivity({ customerProfileId: referral.referrerProfileId, businessId: refBusinessId, type: "REFERRAL_COMPLETED", entityType: "referral", entityId: referral.id });
  const referee = referral.refereeProfileId ? await prisma.customerProfile.findUnique({ where: { id: referral.refereeProfileId }, select: { displayName: true, user: { select: { fullName: true } } } }) : null;
  await notifyLoyalty(referral.referrerProfileId, referral.businessId, "referral_completed", { name: referee?.displayName ?? referee?.user.fullName ?? "A friend" }).catch(() => undefined);
  return updated;
}

export async function myReferrals(customerProfileId: string) {
  const [made, codes] = await Promise.all([
    prisma.referral.findMany({ where: { referrerProfileId: customerProfileId }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.referralCode.findMany({ where: { customerProfileId } }),
  ]);
  const refereeIds = made.map((r) => r.refereeProfileId).filter((v): v is string => Boolean(v));
  const referees = refereeIds.length
    ? await prisma.customerProfile.findMany({ where: { id: { in: refereeIds } }, select: { id: true, displayName: true, user: { select: { fullName: true } } } })
    : [];
  const nameById = new Map(referees.map((r) => [r.id, r.displayName ?? r.user.fullName]));
  return {
    codes: codes.map((c) => ({ code: c.code, businessId: c.businessId, uses: c.uses, referrerPoints: c.referrerPoints })),
    referrals: made.map((r) => ({ id: r.id, status: r.status, refereeName: r.refereeProfileId ? nameById.get(r.refereeProfileId) ?? "New customer" : (r.refereeEmail ?? "Invite pending"), joinedAt: r.joinedAt, completedAt: r.completedAt })),
    summary: {
      total: made.length,
      joined: made.filter((r) => r.status === "joined").length,
      completed: made.filter((r) => r.status === "completed").length,
    },
  };
}
