import { prisma } from "../prisma.js";
import { notifyCustomer } from "../customer/customerNotifications.js";

// PROGRAM 2 LOOP 5: loyalty notifications. Thin wrappers over the existing
// Notification Platform — one category ("loyalty"), best-effort.

export type LoyaltyNotificationKind =
  | "points_earned"
  | "points_expired"
  | "reward_unlocked"
  | "reward_expiring"
  | "tier_up"
  | "milestone"
  | "membership_renewal"
  | "membership_expiring"
  | "referral_completed";

const COPY: Record<LoyaltyNotificationKind, (data: Record<string, unknown>, businessName: string) => { title: string; body: string }> = {
  points_earned: (d, b) => ({ title: "Points earned", body: `You earned ${d.points} points at ${b}. Balance: ${d.balance}.` }),
  points_expired: (_d, b) => ({ title: "Points expired", body: `Some of your points at ${b} have expired.` }),
  reward_unlocked: (d, b) => ({ title: "Reward unlocked", body: `You can now claim "${d.reward}" at ${b}.` }),
  reward_expiring: (d, b) => ({ title: "Reward expiring soon", body: `Your reward "${d.reward}" at ${b} expires ${d.on}.` }),
  tier_up: (d, b) => ({ title: "New loyalty tier", body: `You reached ${d.tier} at ${b}.` }),
  milestone: (d, b) => ({ title: "Loyalty milestone", body: `${d.label} at ${b}.` }),
  membership_renewal: (d, b) => ({ title: "Membership renewed", body: `Your ${d.plan} membership at ${b} renewed.` }),
  membership_expiring: (d, b) => ({ title: "Membership expiring", body: `Your membership at ${b} ends ${d.on}.` }),
  referral_completed: (d, _b) => ({ title: "Referral completed", body: `${d.name ?? "A friend"} completed their first booking — your referral reward is on the way.` }),
};

export async function notifyLoyalty(
  customerProfileId: string,
  businessId: string | null,
  kind: LoyaltyNotificationKind,
  data: Record<string, unknown> = {},
) {
  const business = businessId ? await prisma.business.findUnique({ where: { id: businessId }, select: { name: true } }) : null;
  const { title, body } = COPY[kind](data, business?.name ?? "a business");
  return notifyCustomer({
    customerProfileId,
    category: "loyalty",
    title,
    body,
    businessId: businessId ?? null,
    data: { loyaltyKind: kind, ...data },
  });
}
