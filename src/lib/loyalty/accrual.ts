import { prisma } from "../prisma.js";
import { getLoyaltyProgram } from "./program.js";
import { earnPoints, ensureLoyaltyAccount } from "./pointsEngine.js";
import { activeCampaignFor, applyCampaign } from "./campaigns.js";
import { grantMilestoneRewards } from "./rewards.js";
import { completeReferralOnFirstBooking } from "./referrals.js";

// PROGRAM 2 LOOP 5: the points-earning hooks. Each entry point is best-effort
// and fully idempotent (the pointsEngine unique constraint on
// (account, sourceType, sourceId, kind)), so it is safe to call from the
// existing Booking / Review flows without a transaction contract.

/** Resolves the CustomerProfile that should earn for an appointment, if any. */
async function profileForAppointment(appointment: { bookedByCustomerProfileId: string | null; customerId: string | null; businessId: string }): Promise<string | null> {
  if (appointment.bookedByCustomerProfileId) return appointment.bookedByCustomerProfileId;
  if (!appointment.customerId) return null;
  const link = await prisma.customerBusinessLink.findFirst({
    where: { businessId: appointment.businessId, businessCustomerId: appointment.customerId },
    select: { customerProfileId: true },
  });
  return link?.customerProfileId ?? null;
}

/** Enrols the customer and applies the program's welcome bonus once. */
export async function enrolInLoyalty(businessId: string, customerProfileId: string) {
  const program = await getLoyaltyProgram(businessId);
  if (!program?.active) return null;
  const account = await ensureLoyaltyAccount(businessId, customerProfileId);
  if (program.welcomeBonus > 0) {
    await earnPoints({ businessId, customerProfileId, points: program.welcomeBonus, sourceType: "welcome", sourceId: account.id, reason: "Welcome bonus" }).catch(() => undefined);
  }
  return account;
}

/** Points for a COMPLETED appointment: price × pointsPerCurrency + booking bonus, boosted by any active campaign. */
export async function accrueForCompletedBooking(appointmentId: string): Promise<{ awarded: number } | null> {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, businessId: true, status: true, price: true, paidAmount: true, customerId: true, bookedByCustomerProfileId: true },
  });
  if (!appointment || appointment.status !== "COMPLETED") return null;

  const program = await getLoyaltyProgram(appointment.businessId);
  if (!program?.active) return null;

  const customerProfileId = await profileForAppointment(appointment);
  if (!customerProfileId) return null;

  const spend = Number(appointment.paidAmount ?? 0) || Number(appointment.price ?? 0);
  const base = Math.max(0, Math.round(spend * program.pointsPerCurrency)) + program.pointsPerBookingBonus;
  if (base <= 0) return { awarded: 0 };

  const campaign = await activeCampaignFor(appointment.businessId);
  const boosted = applyCampaign(base, campaign);

  const result = await earnPoints({
    businessId: appointment.businessId,
    customerProfileId,
    points: boosted.total,
    sourceType: "appointment",
    sourceId: appointment.id,
    reason: `Booking completed${boosted.multiplier > 1 || boosted.bonus > 0 ? " (campaign boost)" : ""}`,
    campaignId: campaign?.id ?? null,
    expiresAt: program.pointExpiryDays ? new Date(Date.now() + program.pointExpiryDays * 86_400_000) : null,
  });

  if (result.applied) {
    await grantMilestoneRewards(appointment.businessId, customerProfileId).catch(() => undefined);
  }
  return { awarded: result.applied ? boosted.total : 0 };
}

/** Points for a review the customer left. Idempotent per feedback row. */
export async function accrueForReview(feedbackId: string): Promise<{ awarded: number } | null> {
  const feedback = await prisma.feedback.findUnique({
    where: { id: feedbackId },
    select: { id: true, businessId: true, customerId: true },
  });
  if (!feedback?.customerId) return null;

  const program = await getLoyaltyProgram(feedback.businessId);
  if (!program?.active || program.pointsPerReview <= 0) return null;

  const link = await prisma.customerBusinessLink.findFirst({
    where: { businessId: feedback.businessId, businessCustomerId: feedback.customerId },
    select: { customerProfileId: true },
  });
  if (!link) return null;

  const campaign = await activeCampaignFor(feedback.businessId);
  const boosted = applyCampaign(program.pointsPerReview, campaign);
  const result = await earnPoints({
    businessId: feedback.businessId,
    customerProfileId: link.customerProfileId,
    points: boosted.total,
    sourceType: "review",
    sourceId: feedback.id,
    reason: "Review submitted",
    campaignId: campaign?.id ?? null,
    expiresAt: program.pointExpiryDays ? new Date(Date.now() + program.pointExpiryDays * 86_400_000) : null,
  });
  return { awarded: result.applied ? boosted.total : 0 };
}

/** Called after a customer's booking is created — completes a pending referral on their first booking. */
export async function accrueForBookingCreated(appointmentId: string) {
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: { id: true, bookedByCustomerProfileId: true, businessId: true },
  });
  if (!appointment?.bookedByCustomerProfileId) return;
  await completeReferralOnFirstBooking(appointment.bookedByCustomerProfileId, appointment.id, appointment.businessId).catch(() => undefined);
}
