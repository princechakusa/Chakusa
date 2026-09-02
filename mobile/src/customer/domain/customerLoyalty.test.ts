import { describe, expect, it } from 'vitest';
import type {
  BookableServiceDto, CustomerNotificationDto, LoyaltyRewardDto,
  MarketplaceBusinessProfileDto, RewardRedemptionDto, WalletDto,
} from '../../apiTypes';
import {
  loyaltyNotificationTarget,
  marketplaceLoyaltyBadges,
  memberPriceDisplay,
  membershipPlanPriceCaption,
  pointsAcrossBusinesses,
  profileLoyaltyState,
  redemptionIsUsable,
  redemptionStatusLabel,
  rewardEligibilityReason,
  rewardsHubSections,
  walletIsEmpty,
} from './customerLoyalty';

const emptyWallet: WalletDto = {
  totalPoints: 0, lifetimePoints: 0, accounts: [], memberships: [], activeMemberships: 0,
  rewards: { issued: 0, redeemed: 0, list: [] }, referrals: { total: 0, joined: 0, completed: 0 },
  recentTransactions: [], generatedAt: '2026-09-02T00:00:00Z',
};

function account(id: string, name: string, points: number, tier = 'Bronze', lastActivityAt: string | null = null): WalletDto['accounts'][number] {
  return { businessId: id, business: { id, name, publicSlug: name.toLowerCase() }, pointsBalance: points, lifetimePoints: points, tier: { key: tier.toLowerCase(), name: tier }, lastActivityAt };
}

describe('walletIsEmpty', () => {
  it('is true only when nothing loyalty-related exists', () => {
    expect(walletIsEmpty(emptyWallet)).toBe(true);
    expect(walletIsEmpty({ ...emptyWallet, accounts: [account('b1', 'Glow', 10)] })).toBe(false);
    expect(walletIsEmpty({ ...emptyWallet, referrals: { total: 1, joined: 0, completed: 0 } })).toBe(false);
  });
});

describe('pointsAcrossBusinesses — business-specific separation', () => {
  it('names the single business when there is one account', () => {
    const wallet = { ...emptyWallet, totalPoints: 120, accounts: [account('b1', 'Glow Studio', 120)] };
    expect(pointsAcrossBusinesses(wallet)).toEqual({ total: 120, businessCount: 1, caption: 'at Glow Studio' });
  });

  it('makes clear points stay with each business when there are several', () => {
    const wallet = { ...emptyWallet, totalPoints: 300, accounts: [account('b1', 'Glow', 120), account('b2', 'Sharp', 180)] };
    const result = pointsAcrossBusinesses(wallet);
    expect(result.total).toBe(300);
    expect(result.businessCount).toBe(2);
    expect(result.caption).toMatch(/stay with each business/);
  });

  it('handles no accounts', () => {
    expect(pointsAcrossBusinesses(emptyWallet).caption).toMatch(/no loyalty points/i);
  });
});

describe('rewardsHubSections', () => {
  it('shapes the wallet into hub sections, businesses sorted by recent activity', () => {
    const wallet: WalletDto = {
      ...emptyWallet,
      totalPoints: 300,
      accounts: [account('b1', 'Glow', 120, 'Bronze', '2026-08-01T00:00:00Z'), account('b2', 'Sharp', 180, 'Silver', '2026-09-01T00:00:00Z')],
      activeMemberships: 1,
      rewards: { issued: 2, redeemed: 1, list: [] },
      referrals: { total: 5, joined: 3, completed: 2 },
      recentTransactions: [{ id: 't1', kind: 'earn', points: 20, balanceAfter: 120, reason: 'Booking', sourceType: 'appointment', expiresAt: null, createdAt: '2026-09-01T00:00:00Z', businessId: 'b1', business: { id: 'b1', name: 'Glow', publicSlug: 'glow' } }],
    };
    const sections = rewardsHubSections(wallet);
    expect(sections.businesses.map((b) => b.businessId)).toEqual(['b2', 'b1']);
    expect(sections.rewardsReady).toBe(2);
    expect(sections.activeMemberships).toBe(1);
    expect(sections.referralsCompleted).toBe(2);
    expect(sections.hasActivity).toBe(true);
  });
});

function reward(patch: Partial<LoyaltyRewardDto>): LoyaltyRewardDto {
  return {
    id: 'r1', name: 'Free wash', description: null, type: 'free_service', pointsCost: 200, value: null,
    minTierKey: null, membersOnly: false, affordable: true, pointsShort: 0, tierEligible: true,
    memberEligible: true, redeemable: true, ...patch,
  };
}

describe('rewardEligibilityReason', () => {
  it('explains why a reward is or is not redeemable', () => {
    expect(rewardEligibilityReason(reward({}))).toBe('Ready to redeem');
    expect(rewardEligibilityReason(reward({ affordable: false, pointsShort: 120, redeemable: false }))).toBe('120 more points needed');
    expect(rewardEligibilityReason(reward({ tierEligible: false, minTierKey: 'gold', redeemable: false }))).toMatch(/gold tier/i);
    expect(rewardEligibilityReason(reward({ memberEligible: false, redeemable: false }))).toBe('Membership required');
    expect(rewardEligibilityReason(reward({ type: 'milestone', redeemable: false }))).toMatch(/automatically/i);
  });
});

describe('redemption helpers', () => {
  const base: RewardRedemptionDto = {
    id: 'x1', code: 'RW-ABCD1234', status: 'issued', pointsSpent: 200, issuedAt: '2026-09-01T00:00:00Z',
    redeemedAt: null, expiresAt: null, reward: { name: 'Free wash', type: 'free_service', value: null }, business: { id: 'b1', name: 'Glow', publicSlug: 'glow' },
  };

  it('labels statuses in customer language (never "withdrawal" etc.)', () => {
    expect(redemptionStatusLabel('issued')).toBe('Ready to use');
    expect(redemptionStatusLabel('redeemed')).toBe('Used');
    expect(redemptionStatusLabel('expired')).toBe('Expired');
  });

  it('is usable only while issued/reserved and not past expiry', () => {
    expect(redemptionIsUsable(base)).toBe(true);
    expect(redemptionIsUsable({ ...base, status: 'redeemed' })).toBe(false);
    expect(redemptionIsUsable({ ...base, expiresAt: '2020-01-01T00:00:00Z' })).toBe(false);
    expect(redemptionIsUsable({ ...base, expiresAt: '2999-01-01T00:00:00Z' })).toBe(true);
  });
});

describe('membershipPlanPriceCaption — no payment taken', () => {
  it('always states Chakusa is not collecting the payment', () => {
    const caption = membershipPlanPriceCaption({ priceAmount: 20, currency: 'USD', billingInterval: 'monthly' });
    expect(caption).toMatch(/month/);
    expect(caption).toMatch(/not collecting this payment/i);
  });

  it('handles annual and one-off intervals', () => {
    expect(membershipPlanPriceCaption({ priceAmount: 200, currency: 'GBP', billingInterval: 'annual' })).toMatch(/year/);
    expect(membershipPlanPriceCaption({ priceAmount: 500, currency: null, billingInterval: 'unlimited' })).toMatch(/one-off/);
  });
});

describe('marketplaceLoyaltyBadges', () => {
  it('maps only the badges the backend flags', () => {
    expect(marketplaceLoyaltyBadges({ loyaltyBadge: true, membershipBadge: false })).toEqual(['Rewards']);
    expect(marketplaceLoyaltyBadges({ loyaltyBadge: true, membershipBadge: true })).toEqual(['Rewards', 'Membership']);
    expect(marketplaceLoyaltyBadges({ loyaltyBadge: false, membershipBadge: false })).toEqual([]);
    expect(marketplaceLoyaltyBadges({})).toEqual([]);
  });
});

describe('profileLoyaltyState', () => {
  const withLoyalty = (loyalty: MarketplaceBusinessProfileDto['loyalty']): Pick<MarketplaceBusinessProfileDto, 'loyalty'> => ({ loyalty });

  it('is hidden when the business runs no program and no memberships', () => {
    expect(profileLoyaltyState(withLoyalty(undefined)).show).toBe(false);
    expect(profileLoyaltyState(withLoyalty({ hasProgram: false, hasMemberships: false, pointsPerCurrency: null, membershipPlans: [], rewards: [], viewer: null })).show).toBe(false);
  });

  it('offers "join" for a program the viewer is not enrolled in', () => {
    const state = profileLoyaltyState(withLoyalty({ hasProgram: true, hasMemberships: false, pointsPerCurrency: 1, membershipPlans: [], rewards: [{ id: 'r', name: 'x', type: 'promo', pointsCost: 50, membersOnly: false }], viewer: { pointsBalance: 0, tierKey: null, isMember: false, memberPlanId: null } }));
    expect(state).toMatchObject({ show: true, enrolled: false, primaryAction: 'join', rewardCount: 1 });
  });

  it('offers "view-rewards" once enrolled', () => {
    const state = profileLoyaltyState(withLoyalty({ hasProgram: true, hasMemberships: false, pointsPerCurrency: 1, membershipPlans: [], rewards: [], viewer: { pointsBalance: 120, tierKey: 'silver', isMember: false, memberPlanId: null } }));
    expect(state).toMatchObject({ enrolled: true, primaryAction: 'view-rewards', pointsBalance: 120, tierKey: 'silver' });
  });

  it('offers "view-membership" when only memberships exist', () => {
    const state = profileLoyaltyState(withLoyalty({ hasProgram: false, hasMemberships: true, pointsPerCurrency: null, membershipPlans: [{ id: 'p', name: 'Gold', billingInterval: 'monthly', priceAmount: 20, currency: 'USD', discountPercent: 10, priorityBooking: true }], rewards: [], viewer: null }));
    expect(state).toMatchObject({ show: true, hasMemberships: true, primaryAction: 'view-membership' });
  });
});

describe('memberPriceDisplay — server values only', () => {
  const svc = (patch: Partial<BookableServiceDto>): Pick<BookableServiceDto, 'price' | 'memberPrice'> => ({ price: 100, memberPrice: 100, ...patch });

  it('shows a member price only when it is genuinely lower', () => {
    expect(memberPriceDisplay(svc({ memberPrice: 80 }), 'USD')).toMatchObject({ hasMemberPrice: true });
    expect(memberPriceDisplay(svc({ memberPrice: 100 }), 'USD').hasMemberPrice).toBe(false);
    expect(memberPriceDisplay(svc({ price: null, memberPrice: null }), 'USD')).toEqual({ hasMemberPrice: false, regular: null, member: null });
  });
});

describe('loyaltyNotificationTarget — customer-app deep link only', () => {
  const note = (data: Record<string, unknown>, businessId: string | null = 'b1'): Pick<CustomerNotificationDto, 'category' | 'businessId' | 'data'> =>
    ({ category: 'loyalty', businessId, data });

  it('routes reward events to the business loyalty detail', () => {
    expect(loyaltyNotificationTarget(note({ loyaltyKind: 'reward_unlocked' }))).toEqual({ route: 'CustomerLoyaltyBusiness', businessId: 'b1' });
    expect(loyaltyNotificationTarget(note({ loyaltyKind: 'reward_expiring' }, null))).toEqual({ route: 'CustomerRedemptions' });
  });

  it('routes membership and referral events to their screens', () => {
    expect(loyaltyNotificationTarget(note({ loyaltyKind: 'membership_expiring' }))).toEqual({ route: 'CustomerMemberships' });
    expect(loyaltyNotificationTarget(note({ loyaltyKind: 'referral_completed' }))).toEqual({ route: 'CustomerReferrals' });
  });

  it('routes points/tier events to the business detail, falling back to the hub', () => {
    expect(loyaltyNotificationTarget(note({ loyaltyKind: 'tier_up' }))).toEqual({ route: 'CustomerLoyaltyBusiness', businessId: 'b1' });
    expect(loyaltyNotificationTarget(note({ loyaltyKind: 'points_earned' }, null))).toEqual({ route: 'CustomerRewards' });
  });

  it('falls back to the hub for unknown kinds and non-loyalty categories', () => {
    expect(loyaltyNotificationTarget(note({ loyaltyKind: 'mystery' }))).toEqual({ route: 'CustomerRewards' });
    expect(loyaltyNotificationTarget({ category: 'booking_update', businessId: 'b1', data: {} })).toEqual({ route: 'CustomerRewards' });
  });
});
