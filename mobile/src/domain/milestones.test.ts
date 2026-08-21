import { describe, expect, it } from 'vitest';
import { dashboardMilestones, milestoneCopy, recoveryEngineReadyMilestone, unseenMilestones } from './milestones';

const dashboard = (overrides: Partial<{ leadsTotal: number; leadsWon: number; requestsSent: number; comebackCompletedCount: number }> = {}) => ({
  leads: { missedCalls: 0, new: 0, contacted: 0, booked: 0, won: overrides.leadsWon ?? 0, lost: 0, total: overrides.leadsTotal ?? 0, conversionRate: 0, contactRate: 0 },
  reviews: { requestsSent: overrides.requestsSent ?? 0, reviewsReceived: 0, feedbackReceived: 0 },
  recoveredRevenue: { total: 0, missedCall: 0, comebackCompletedCount: overrides.comebackCompletedCount ?? 0, outstanding: 0 },
  businessHealth: { score: null, label: null },
});

describe('dashboard milestones', () => {
  it('detects nothing at zero', () => expect(dashboardMilestones(dashboard())).toEqual([]));
  it('detects the first lead exactly at count 1', () => expect(dashboardMilestones(dashboard({ leadsTotal: 1 }))).toContain('first_lead_recovered'));
  it('never re-fires past the first occurrence', () => expect(dashboardMilestones(dashboard({ leadsTotal: 2 }))).not.toContain('first_lead_recovered'));
  it('detects first customer won, first review sent, and first returning customer independently', () => {
    const reached = dashboardMilestones(dashboard({ leadsWon: 1, requestsSent: 1, comebackCompletedCount: 1 }));
    expect(reached).toEqual(expect.arrayContaining(['first_customer_won', 'first_review_sent', 'first_returning_customer']));
  });
  it('can report multiple milestones reached in the same refresh', () => {
    expect(dashboardMilestones(dashboard({ leadsTotal: 1, leadsWon: 1 })).length).toBe(2);
  });
});

describe('recovery engine ready milestone', () => {
  it('fires only when overall status is active', () => {
    expect(recoveryEngineReadyMilestone('active')).toEqual(['recovery_engine_ready']);
    expect(recoveryEngineReadyMilestone('attention')).toEqual([]);
    expect(recoveryEngineReadyMilestone('not_started')).toEqual([]);
  });
});

describe('unseen milestone filtering', () => {
  it('excludes milestones already shown on this device', () => {
    expect(unseenMilestones(['first_lead_recovered', 'first_customer_won'], new Set(['first_lead_recovered']))).toEqual(['first_customer_won']);
  });
  it('returns everything when nothing has been seen yet', () => {
    expect(unseenMilestones(['first_review_sent'], new Set())).toEqual(['first_review_sent']);
  });
});

describe('milestone copy', () => {
  it('provides real, non-empty copy for every milestone key', () => {
    const keys = ['recovery_engine_ready', 'first_lead_recovered', 'first_customer_won', 'first_review_sent', 'first_returning_customer'] as const;
    for (const key of keys) {
      const copy = milestoneCopy(key);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.message.length).toBeGreaterThan(0);
    }
  });
});
