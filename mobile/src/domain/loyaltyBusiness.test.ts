import { describe, expect, it } from 'vitest';
import type { LoyaltyBusinessAnalyticsDto } from '../apiTypes';
import {
  analyticsTiles,
  billingIntervalLabel,
  campaignKindLabel,
  campaignWindowLabel,
  canMarkRedeemed,
  canRevoke,
  normaliseRedemptionCode,
  programStatusLabel,
  projectedBalance,
  redemptionStatusLabel,
  resolveAdjustment,
  rewardTypeLabel,
  rewardValueSummary,
  tierBreakdownRows,
  validateCampaignDraft,
  validatePlanDraft,
  validateProgramDraft,
  validateRewardDraft,
  validateTiers,
} from './loyaltyBusiness';

const programDraft = (over: Partial<Parameters<typeof validateProgramDraft>[0]> = {}) => ({
  active: true, pointsPerCurrency: '10', pointsPerBookingBonus: '0', pointsPerReview: '0',
  pointsPerReferral: '0', pointExpiryDays: '', welcomeBonus: '0', ...over,
});

describe('loyaltyBusiness domain (Program 2, Loop 6)', () => {
  describe('program status + validation', () => {
    it('labels program status', () => {
      expect(programStatusLabel(null)).toBe('Not set up');
      expect(programStatusLabel({ configured: false, active: false })).toBe('Not set up');
      expect(programStatusLabel({ active: false })).toBe('Paused');
      expect(programStatusLabel({ active: true })).toBe('Active');
    });
    it('accepts a valid program draft and builds the API input', () => {
      const r = validateProgramDraft(programDraft({ pointsPerCurrency: '5', welcomeBonus: '100', pointExpiryDays: '365' }));
      expect(r.ok).toBe(true);
      expect(r.input).toMatchObject({ pointsPerCurrency: 5, welcomeBonus: 100, pointExpiryDays: 365 });
    });
    it('treats blank expiry as never (null)', () => {
      expect(validateProgramDraft(programDraft({ pointExpiryDays: '' })).input?.pointExpiryDays).toBeNull();
    });
    it('rejects bad numbers', () => {
      expect(validateProgramDraft(programDraft({ pointsPerCurrency: '9999' })).errors.pointsPerCurrency).toBeTruthy();
      expect(validateProgramDraft(programDraft({ welcomeBonus: '-5' })).errors.welcomeBonus).toBeTruthy();
      expect(validateProgramDraft(programDraft({ pointExpiryDays: '0' })).errors.pointExpiryDays).toBeTruthy();
    });
  });

  describe('tier config', () => {
    it('accepts an ordered, unique, zero-based tier list', () => {
      const r = validateTiers([
        { key: 'Bronze', name: 'Bronze', minPoints: '0' },
        { key: 'Silver', name: 'Silver', minPoints: '500' },
        { key: 'Gold', name: 'Gold', minPoints: '1500' },
      ]);
      expect(r.ok).toBe(true);
      expect(r.tiers?.map((t) => t.key)).toEqual(['bronze', 'silver', 'gold']);
    });
    it('rejects out-of-order, duplicate, or non-zero-first tiers', () => {
      expect(validateTiers([{ key: 'a', name: 'A', minPoints: '100' }]).error).toMatch(/start at 0/);
      expect(validateTiers([{ key: 'a', name: 'A', minPoints: '0' }, { key: 'a', name: 'B', minPoints: '10' }]).error).toMatch(/Duplicate/);
      expect(validateTiers([{ key: 'a', name: 'A', minPoints: '0' }, { key: 'b', name: 'B', minPoints: '0' }]).error).toMatch(/increasing/);
    });
    it('allows zero tiers (backend default applies)', () => {
      expect(validateTiers([])).toEqual({ ok: true, error: null, tiers: [] });
    });
  });

  describe('reward labels + validation', () => {
    it('never exposes raw enum names', () => {
      expect(rewardTypeLabel('percent_discount')).toBe('Percentage discount');
      expect(rewardTypeLabel('free_service')).toBe('Free service');
      expect(rewardValueSummary({ type: 'percent_discount', value: 20 })).toBe('20% off');
      expect(rewardValueSummary({ type: 'fixed_discount', value: 10 }, 'GBP')).toMatch(/10 off$/);
      expect(rewardValueSummary({ type: 'free_service', value: null })).toBe('Free service');
    });
    it('validates a reward draft', () => {
      const base = { name: 'Wash', description: '', type: 'free_service' as const, pointsCost: '500', value: '', minTierKey: '', membersOnly: false, autoGrant: false, milestoneBookings: '', redemptionValidityDays: '' };
      expect(validateRewardDraft(base).ok).toBe(true);
      expect(validateRewardDraft({ ...base, name: '  ' }).error).toMatch(/needs a name/);
      expect(validateRewardDraft({ ...base, type: 'percent_discount', value: '' }).error).toMatch(/percentage/i);
      expect(validateRewardDraft({ ...base, type: 'percent_discount', value: '150' }).error).toMatch(/between 1 and 100/);
      expect(validateRewardDraft({ ...base, type: 'milestone', milestoneBookings: '0' }).error).toMatch(/completed-bookings/);
      expect(validateRewardDraft({ ...base, redemptionValidityDays: '999' }).error).toMatch(/1.365/);
    });
  });

  describe('membership plans', () => {
    it('labels billing intervals', () => {
      expect(billingIntervalLabel('monthly')).toBe('Monthly');
      expect(billingIntervalLabel('unlimited')).toBe('One-off / unlimited');
    });
    it('validates a plan draft', () => {
      const base = { name: 'Gold', description: '', billingInterval: 'monthly' as const, priceAmount: '20', priorityBooking: true, discountPercent: '15' };
      expect(validatePlanDraft(base).ok).toBe(true);
      expect(validatePlanDraft({ ...base, name: '' }).error).toMatch(/name/);
      expect(validatePlanDraft({ ...base, discountPercent: '120' }).error).toMatch(/between 0 and 100/);
    });
  });

  describe('campaigns', () => {
    it('labels kinds and windows', () => {
      expect(campaignKindLabel('multiplier')).toBe('Points multiplier');
      const now = new Date('2026-06-15T00:00:00Z');
      expect(campaignWindowLabel({ startsAt: '2026-06-01T00:00:00Z', endsAt: '2026-06-30T00:00:00Z', active: true }, now)).toBe('Running');
      expect(campaignWindowLabel({ startsAt: '2026-07-01T00:00:00Z', endsAt: '2026-07-30T00:00:00Z', active: true }, now)).toBe('Scheduled');
      expect(campaignWindowLabel({ startsAt: '2026-01-01T00:00:00Z', endsAt: '2026-02-01T00:00:00Z', active: true }, now)).toBe('Ended');
      expect(campaignWindowLabel({ startsAt: '2026-06-01T00:00:00Z', endsAt: '2026-06-30T00:00:00Z', active: false }, now)).toBe('Off');
    });
    it('validates a campaign draft', () => {
      const base = { name: 'Double week', description: '', kind: 'multiplier' as const, multiplier: '2', bonusPoints: '0', startsAt: '2026-06-01T00:00:00Z', endsAt: '2026-06-08T00:00:00Z' };
      expect(validateCampaignDraft(base).ok).toBe(true);
      expect(validateCampaignDraft({ ...base, endsAt: '2026-05-01T00:00:00Z' }).error).toMatch(/after the start/);
      expect(validateCampaignDraft({ ...base, multiplier: '99' }).error).toMatch(/between 1 and 20/);
      expect(validateCampaignDraft({ ...base, kind: 'bonus_points', bonusPoints: '-1' }).error).toMatch(/whole number/);
    });
  });

  describe('manual point adjustment', () => {
    it('builds a signed value and requires a reason', () => {
      expect(resolveAdjustment({ amount: '100', direction: 'add', reason: 'Goodwill credit' })).toMatchObject({ ok: true, points: 100 });
      expect(resolveAdjustment({ amount: '50', direction: 'remove', reason: 'Correcting a duplicate' })).toMatchObject({ ok: true, points: -50 });
      expect(resolveAdjustment({ amount: '50', direction: 'add', reason: 'no' }).error).toMatch(/reason is required/);
      expect(resolveAdjustment({ amount: '0', direction: 'add', reason: 'x reason' }).error).toMatch(/greater than 0/);
      expect(resolveAdjustment({ amount: '2000000', direction: 'add', reason: 'big' }).error).toMatch(/1,000,000/);
    });
    it('projects the resulting balance without going negative', () => {
      expect(projectedBalance(300, -500)).toBe(0);
      expect(projectedBalance(300, 200)).toBe(500);
    });
  });

  describe('analytics shaping', () => {
    const analytics: LoyaltyBusinessAnalyticsDto = {
      programActive: true, members: 42, tierBreakdown: { bronze: 30, silver: 10, gold: 2 },
      outstandingPoints: 12500, lifetimePointsIssued: 90000,
      last30Days: { pointsEarned: 4000, earnEvents: 55, pointsRedeemed: 1500, redeemEvents: 12 },
      redemptions: { issued: 8, redeemed: 12 }, memberships: { active: 5 }, activeCampaigns: 1,
    };
    it('builds tiles with a net figure', () => {
      const tiles = analyticsTiles(analytics);
      expect(tiles.find((t) => t.key === 'net30')?.value).toBe('+2,500');
      expect(tiles.find((t) => t.key === 'members')?.value).toBe('42');
    });
    it('builds sorted tier breakdown rows with shares', () => {
      const rows = tierBreakdownRows(analytics);
      expect(rows.map((r) => r.tier)).toEqual(['bronze', 'silver', 'gold']);
      expect(rows[0].share).toBeCloseTo(0.714, 2);
    });
  });

  describe('redemption controls', () => {
    it('labels statuses', () => {
      expect(redemptionStatusLabel('issued')).toBe('Issued');
      expect(redemptionStatusLabel('weird')).toBe('weird');
    });
    it('gates mark-redeemed and revoke', () => {
      const future = '2999-01-01T00:00:00Z';
      const past = '2000-01-01T00:00:00Z';
      expect(canMarkRedeemed('issued', future)).toBe(true);
      expect(canMarkRedeemed('issued', past)).toBe(false);
      expect(canMarkRedeemed('redeemed', future)).toBe(false);
      expect(canRevoke('issued')).toBe(true);
      expect(canRevoke('redeemed')).toBe(false);
    });
    it('normalises a scanned/typed code', () => {
      expect(normaliseRedemptionCode('  rw-12ab 34cd ')).toBe('RW-12AB34CD');
    });
  });
});
