import { describe, expect, it } from 'vitest';
import type { CustomerMembershipDto, LoyaltyRewardDto, LoyaltyTransactionDto, MembershipPlanDto, ReferralOverviewDto, WalletDto } from '../apiTypes';
import {
  canNavigateLoyalty,
  formatPoints,
  groupTransactionsByMonth,
  isProhibitedLoyaltyRoute,
  memberPrice,
  membershipSavings,
  membershipStatusLabel,
  redemptionCodeDisplay,
  referralProgress,
  referralStatusLabel,
  rewardCtaLabel,
  rewardValueLabel,
  shareInviteMessage,
  sortRewards,
  tierProgress,
  transactionLabel,
  walletSummary,
} from './loyalty';

const reward = (over: Partial<LoyaltyRewardDto> = {}): LoyaltyRewardDto => ({
  id: over.id ?? 'r1', name: 'Free wash', description: null, type: over.type ?? 'free_service',
  pointsCost: over.pointsCost ?? 500, value: over.value ?? null, minTierKey: over.minTierKey ?? null,
  membersOnly: over.membersOnly ?? false, affordable: over.affordable ?? true, pointsShort: over.pointsShort ?? 0,
  tierEligible: over.tierEligible ?? true, memberEligible: over.memberEligible ?? true, redeemable: over.redeemable ?? true,
  ...over,
});

const txn = (over: Partial<LoyaltyTransactionDto> = {}): LoyaltyTransactionDto => ({
  id: over.id ?? 't1', kind: over.kind ?? 'earn', points: over.points ?? 50, balanceAfter: over.balanceAfter ?? 50,
  reason: over.reason ?? null, sourceType: over.sourceType ?? 'appointment', expiresAt: null,
  createdAt: over.createdAt ?? '2026-09-01T10:00:00.000Z', ...over,
});

describe('loyalty domain (Program 2, Loop 5)', () => {
  describe('navigation — no payment/cash-out', () => {
    it('allows the five loyalty routes', () => {
      for (const r of ['Loyalty', 'Membership', 'Rewards', 'Wallet', 'Referrals']) expect(canNavigateLoyalty(r)).toBe(true);
    });
    it('rejects prohibited routes', () => {
      for (const r of ['Payment', 'Checkout', 'CashOut', 'BuyPoints', 'TopUp', 'GiftCard', 'StoredValue']) {
        expect(isProhibitedLoyaltyRoute(r)).toBe(true);
        expect(canNavigateLoyalty(r)).toBe(false);
      }
    });
  });

  describe('points & tiers', () => {
    it('formats points', () => {
      expect(formatPoints(1)).toBe('1 pt');
      expect(formatPoints(1500)).toBe('1,500 pts');
    });
    it('computes tier progress ratio', () => {
      const p = tierProgress({
        lifetimePoints: 700,
        tier: { key: 'silver', name: 'Silver', minPoints: 500 },
        nextTier: { key: 'gold', name: 'Gold', pointsAway: 800 },
        allTiers: [
          { key: 'bronze', name: 'Bronze', minPoints: 0 },
          { key: 'silver', name: 'Silver', minPoints: 500 },
          { key: 'gold', name: 'Gold', minPoints: 1500 },
        ],
      });
      expect(p.nextTier).toBe('Gold');
      expect(p.pointsAway).toBe(800);
      expect(p.ratio).toBeCloseTo(0.2, 5); // 200 done of a 1000-point band
    });
    it('returns full progress at the top tier', () => {
      const p = tierProgress({ lifetimePoints: 5000, tier: { key: 'platinum', name: 'Platinum' }, nextTier: null, allTiers: [] });
      expect(p.ratio).toBe(1);
    });
  });

  describe('rewards', () => {
    it('labels value and CTA', () => {
      expect(rewardValueLabel(reward({ type: 'percent_discount', value: 20 }))).toBe('20% off');
      expect(rewardCtaLabel(reward())).toBe('Redeem');
      expect(rewardCtaLabel(reward({ affordable: false, pointsShort: 120, redeemable: false }))).toBe('120 pts to go');
      expect(rewardCtaLabel(reward({ memberEligible: false }))).toBe('Members only');
      expect(rewardCtaLabel(reward({ type: 'milestone' }))).toBe('Earned automatically');
    });
    it('sorts redeemable first, then closest to affordable', () => {
      const rewards = [
        reward({ id: 'far', redeemable: false, affordable: false, pointsShort: 300 }),
        reward({ id: 'ready', redeemable: true, pointsShort: 0, pointsCost: 400 }),
        reward({ id: 'close', redeemable: false, affordable: false, pointsShort: 50 }),
      ];
      expect(sortRewards(rewards).map((r) => r.id)).toEqual(['ready', 'close', 'far']);
    });
    it('formats a redemption code', () => {
      expect(redemptionCodeDisplay('rwab12cd34')).toBe('RWAB 12CD 34');
    });
  });

  describe('transactions', () => {
    it('labels a transaction and groups by month', () => {
      expect(transactionLabel(txn({ kind: 'earn', points: 50, reason: null }))).toBe('Points earned (+50)');
      expect(transactionLabel(txn({ kind: 'redeem', points: -200, reason: 'Redeemed "Free wash"' }))).toBe('Redeemed "Free wash" (-200)');
      const groups = groupTransactionsByMonth([
        txn({ id: 'a', createdAt: '2026-09-02T00:00:00.000Z' }),
        txn({ id: 'b', createdAt: '2026-08-15T00:00:00.000Z' }),
        txn({ id: 'c', createdAt: '2026-09-20T00:00:00.000Z' }),
      ]);
      expect(groups.map((g) => g.month)).toEqual(['2026-09', '2026-08']);
      expect(groups[0].items.map((i) => i.id)).toEqual(['c', 'a']);
    });
  });

  describe('memberships', () => {
    it('estimates savings net of price', () => {
      const plan: Pick<MembershipPlanDto, 'discountPercent' | 'priceAmount' | 'billingInterval'> = { discountPercent: 20, priceAmount: 30, billingInterval: 'monthly' };
      expect(membershipSavings(plan, 100)).toBe(-10); // 20 discount - 30 price
      expect(membershipSavings({ ...plan, billingInterval: 'annual', priceAmount: 300 }, 100)).toBe(-60); // 240 - 300
    });
    it('computes member price', () => {
      expect(memberPrice(50, 0)).toBe(50);
      expect(memberPrice(50, 20)).toBe(40);
    });
    it('labels status', () => {
      const m = (over: Partial<CustomerMembershipDto>) => ({ status: 'active' as const, cancelAtPeriodEnd: false, currentPeriodEnd: null, ...over });
      expect(membershipStatusLabel(m({ cancelAtPeriodEnd: true }))).toBe('Ends at period end');
      expect(membershipStatusLabel(m({ status: 'expired' }))).toBe('Expired');
    });
  });

  describe('wallet & referrals', () => {
    it('summarizes a wallet', () => {
      const wallet: WalletDto = {
        totalPoints: 900, lifetimePoints: 2000,
        accounts: [
          { businessId: 'b1', business: null, pointsBalance: 400, lifetimePoints: 900, tier: { key: 'silver', name: 'Silver' }, lastActivityAt: null },
          { businessId: 'b2', business: null, pointsBalance: 500, lifetimePoints: 1100, tier: { key: 'gold', name: 'Gold' }, lastActivityAt: null },
        ],
        memberships: [], activeMemberships: 1,
        rewards: { issued: 2, redeemed: 3, list: [] },
        referrals: { total: 4, joined: 3, completed: 2 },
        recentTransactions: [], generatedAt: '2026-09-01T00:00:00.000Z',
      };
      const s = walletSummary(wallet);
      expect(s).toMatchObject({ totalPoints: 900, businessCount: 2, topTier: 'gold', activeMemberships: 1, unusedRewards: 2, referralsCompleted: 2 });
    });
    it('computes referral conversion', () => {
      const overview: ReferralOverviewDto = { codes: [], referrals: [], summary: { total: 4, joined: 3, completed: 1 } };
      expect(referralProgress(overview)).toEqual({ invited: 4, joined: 3, completed: 1, conversionRate: 0.25 });
      expect(referralStatusLabel('completed')).toBe('Completed');
      expect(shareInviteMessage('CODE-1', 'https://chakusa.app/invite/CODE-1')).toContain('CODE-1');
    });
  });
});
