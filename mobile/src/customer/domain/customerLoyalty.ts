import type {
  BookableServiceDto,
  CustomerNotificationDto,
  LoyaltyRewardDto,
  MarketplaceBusinessProfileDto,
  MarketplaceCardDto,
  RewardRedemptionDto,
  WalletDto,
} from '../../apiTypes';
import { formatMoney } from '../../utils/format';

// PROGRAM 2 LOOP 8: pure presentation rules for the customer loyalty
// experience. Networking, eligibility authority and points arithmetic all
// live server-side (Program 2 Loop 5). This module only shapes the wallet
// payload into the hub's sections, maps statuses/notifications to safe
// display, and keeps the "points are business-specific, not money" and
// "membership takes no payment" framing consistent everywhere.

// --- Wallet / hub shaping ------------------------------------------------

export function walletIsEmpty(wallet: WalletDto): boolean {
  return wallet.accounts.length === 0
    && wallet.memberships.length === 0
    && wallet.rewards.list.length === 0
    && wallet.referrals.total === 0;
}

export interface HubBusiness {
  businessId: string;
  name: string;
  slug: string | null;
  pointsBalance: number;
  tierName: string;
  lastActivityAt: string | null;
}

export function hubBusinesses(wallet: WalletDto): HubBusiness[] {
  return [...wallet.accounts]
    .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
    .map((account) => ({
      businessId: account.businessId,
      name: account.business?.name ?? 'A business',
      slug: account.business?.publicSlug ?? null,
      pointsBalance: account.pointsBalance,
      tierName: account.tier.name,
      lastActivityAt: account.lastActivityAt,
    }));
}

/**
 * Total points across businesses, with copy that makes clear the total is
 * NOT a single spendable balance — each business's points stay with that
 * business. Never call this a wallet balance or money.
 */
export function pointsAcrossBusinesses(wallet: WalletDto): { total: number; businessCount: number; caption: string } {
  const businessCount = wallet.accounts.length;
  if (businessCount === 0) return { total: 0, businessCount: 0, caption: 'You have no loyalty points yet' };
  if (businessCount === 1) return { total: wallet.totalPoints, businessCount, caption: `at ${wallet.accounts[0].business?.name ?? 'one business'}` };
  return {
    total: wallet.totalPoints,
    businessCount,
    caption: `across ${businessCount} businesses · points stay with each business`,
  };
}

export interface HubSections {
  points: { total: number; businessCount: number; caption: string };
  businesses: HubBusiness[];
  rewardsReady: number;
  activeMemberships: number;
  referralsCompleted: number;
  hasActivity: boolean;
}

export function rewardsHubSections(wallet: WalletDto): HubSections {
  return {
    points: pointsAcrossBusinesses(wallet),
    businesses: hubBusinesses(wallet),
    rewardsReady: wallet.rewards.issued,
    activeMemberships: wallet.activeMemberships,
    referralsCompleted: wallet.referrals.completed,
    hasActivity: wallet.recentTransactions.length > 0,
  };
}

// --- Rewards -----------------------------------------------------------

/** A plain-language reason a reward can or cannot be redeemed right now. */
export function rewardEligibilityReason(reward: Pick<LoyaltyRewardDto, 'type' | 'redeemable' | 'affordable' | 'pointsShort' | 'tierEligible' | 'memberEligible' | 'minTierKey'>): string {
  if (reward.type === 'milestone') return 'Granted automatically when you reach the milestone';
  if (!reward.memberEligible) return 'Membership required';
  if (!reward.tierEligible) return reward.minTierKey ? `Reach ${reward.minTierKey} tier to unlock` : 'A higher tier is required';
  if (!reward.affordable) return `${reward.pointsShort.toLocaleString('en-US')} more points needed`;
  return reward.redeemable ? 'Ready to redeem' : 'Not available right now';
}

// --- Redemptions -----------------------------------------------------

export function redemptionStatusLabel(status: RewardRedemptionDto['status']): string {
  return { issued: 'Ready to use', reserved: 'Reserved', redeemed: 'Used', expired: 'Expired', revoked: 'Cancelled' }[status];
}

/** True when the customer can still show this code to the business. */
export function redemptionIsUsable(r: Pick<RewardRedemptionDto, 'status' | 'expiresAt'>, now: Date = new Date()): boolean {
  if (r.status !== 'issued' && r.status !== 'reserved') return false;
  return !r.expiresAt || new Date(r.expiresAt).getTime() > now.getTime();
}

// --- Memberships -----------------------------------------------------

/**
 * Truthful price caption for a membership plan. Loop 5 records the
 * entitlement WITHOUT taking payment, so the customer app must not imply a
 * charge. Always pair the price with that fact.
 */
export function membershipPlanPriceCaption(plan: { priceAmount: number; currency: string | null; billingInterval: string }): string {
  const interval = plan.billingInterval === 'annual' ? 'year' : plan.billingInterval === 'unlimited' ? 'one-off' : 'month';
  const price = formatMoney(plan.priceAmount, plan.currency ?? 'USD');
  return `${price} / ${interval} — Chakusa is not collecting this payment`;
}

// --- Marketplace / profile loyalty visibility ------------------------

export function marketplaceLoyaltyBadges(card: Pick<MarketplaceCardDto, 'loyaltyBadge' | 'membershipBadge'>): string[] {
  const badges: string[] = [];
  if (card.loyaltyBadge) badges.push('Rewards');
  if (card.membershipBadge) badges.push('Membership');
  return badges;
}

export interface ProfileLoyaltyState {
  show: boolean;
  hasProgram: boolean;
  hasMemberships: boolean;
  enrolled: boolean;
  pointsBalance: number;
  tierKey: string | null;
  isMember: boolean;
  rewardCount: number;
  primaryAction: 'join' | 'view-rewards' | 'view-membership' | null;
}

export function profileLoyaltyState(profile: Pick<MarketplaceBusinessProfileDto, 'loyalty'>): ProfileLoyaltyState {
  const loyalty = profile.loyalty;
  if (!loyalty || (!loyalty.hasProgram && !loyalty.hasMemberships)) {
    return { show: false, hasProgram: false, hasMemberships: false, enrolled: false, pointsBalance: 0, tierKey: null, isMember: false, rewardCount: 0, primaryAction: null };
  }
  const enrolled = Boolean(loyalty.viewer && (loyalty.viewer.pointsBalance > 0 || loyalty.viewer.tierKey !== null));
  const primaryAction: ProfileLoyaltyState['primaryAction'] = loyalty.hasProgram && !enrolled
    ? 'join'
    : loyalty.hasProgram
      ? 'view-rewards'
      : loyalty.hasMemberships
        ? 'view-membership'
        : null;
  return {
    show: true,
    hasProgram: loyalty.hasProgram,
    hasMemberships: loyalty.hasMemberships,
    enrolled,
    pointsBalance: loyalty.viewer?.pointsBalance ?? 0,
    tierKey: loyalty.viewer?.tierKey ?? null,
    isMember: loyalty.viewer?.isMember ?? false,
    rewardCount: loyalty.rewards.length,
    primaryAction,
  };
}

// --- Booking member pricing --------------------------------------------

export interface MemberPriceDisplay {
  hasMemberPrice: boolean;
  regular: string | null;
  member: string | null;
}

/** Regular vs member price for a bookable service — server values only. */
export function memberPriceDisplay(service: Pick<BookableServiceDto, 'price' | 'memberPrice'>, currency: string | null): MemberPriceDisplay {
  if (service.price == null) return { hasMemberPrice: false, regular: null, member: null };
  const regular = formatMoney(service.price, currency ?? 'USD');
  if (service.memberPrice == null || service.memberPrice >= service.price) {
    return { hasMemberPrice: false, regular, member: null };
  }
  return { hasMemberPrice: true, regular, member: formatMoney(service.memberPrice, currency ?? 'USD') };
}

// --- Loyalty notifications → customer deep-link -----------------------

export type LoyaltyNotificationTarget =
  | { route: 'CustomerRewards' }
  | { route: 'CustomerLoyaltyBusiness'; businessId: string }
  | { route: 'CustomerRedemptions' }
  | { route: 'CustomerMemberships' }
  | { route: 'CustomerReferrals' };

/**
 * Where a loyalty notification tap should land inside the CUSTOMER app.
 * Never routes into business loyalty-management screens; unknown kinds fall
 * back to the rewards hub.
 */
export function loyaltyNotificationTarget(
  notification: Pick<CustomerNotificationDto, 'category' | 'businessId' | 'data'>,
): LoyaltyNotificationTarget {
  if (notification.category !== 'loyalty') return { route: 'CustomerRewards' };
  const kind = typeof notification.data?.loyaltyKind === 'string' ? notification.data.loyaltyKind : '';
  switch (kind) {
    case 'reward_unlocked':
    case 'reward_expiring':
      return notification.businessId
        ? { route: 'CustomerLoyaltyBusiness', businessId: notification.businessId }
        : { route: 'CustomerRedemptions' };
    case 'membership_renewal':
    case 'membership_expiring':
      return { route: 'CustomerMemberships' };
    case 'referral_completed':
      return { route: 'CustomerReferrals' };
    case 'points_earned':
    case 'points_expired':
    case 'tier_up':
    case 'milestone':
      return notification.businessId
        ? { route: 'CustomerLoyaltyBusiness', businessId: notification.businessId }
        : { route: 'CustomerRewards' };
    default:
      return { route: 'CustomerRewards' };
  }
}
