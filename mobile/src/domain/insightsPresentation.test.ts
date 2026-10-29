import { describe, expect, it } from 'vitest';
import type { BusinessInsightsDto, MonthlyTrendPointDto } from '../apiTypes';
import { barFractions, changeLabel, lifecycleShares, monthChange, monthHeadline, percent, recoveryTimeCopy, serviceBars } from './insightsPresentation';

const point = (month: string, over: Partial<MonthlyTrendPointDto> = {}): MonthlyTrendPointDto => ({ month, newLeads: 0, wonLeads: 0, conversionRate: null, newCustomers: 0, returningCustomers: 0, recoveredRevenue: 0, reviewRequestsSent: 0, reviewsReceived: 0, remindersCompleted: 0, ...over });

describe('month over month', () => {
  it('compares the newest month with the one before', () => {
    const change = monthChange([point('2026-08', { recoveredRevenue: 200 }), point('2026-09', { recoveredRevenue: 250 })], 'recoveredRevenue');
    expect(change).toMatchObject({ current: 250, previous: 200, direction: 'up' });
    expect(changeLabel(change)).toBe('+25%');
    expect(changeLabel(monthChange([point('a', { newLeads: 10 }), point('b', { newLeads: 9 })], 'newLeads'))).toBe('-10%');
  });

  it('handles first month, a zero base and no change', () => {
    expect(changeLabel(monthChange([point('2026-09', { newLeads: 4 })], 'newLeads'))).toBeNull();
    expect(changeLabel(monthChange([point('a'), point('b', { newLeads: 3 })], 'newLeads'))).toBe('New this month');
    expect(changeLabel(monthChange([point('a', { newLeads: 3 }), point('b', { newLeads: 3 })], 'newLeads'))).toBe('No change');
    expect(monthChange([], 'newLeads')).toMatchObject({ current: 0, direction: 'none' });
  });
});

describe('chart bars', () => {
  it('scales to the tallest, keeps a stub for small values and none for zero', () => {
    expect(barFractions([0, 50, 100])).toEqual([0, 0.5, 1]);
    expect(barFractions([1, 100])[0]).toBe(0.06);
    expect(barFractions([0, 0])).toEqual([0, 0]);
    expect(barFractions([])).toEqual([]);
  });
});

describe('headline', () => {
  const insights = (trend: MonthlyTrendPointDto[]) => ({ monthlyTrend: trend }) as unknown as BusinessInsightsDto;
  it('says something useful for up, down and quiet months, and nothing with no data', () => {
    expect(monthHeadline(insights([point('a', { recoveredRevenue: 100 }), point('b', { recoveredRevenue: 150 })]))).toContain('up 50%');
    expect(monthHeadline(insights([point('a', { recoveredRevenue: 100 }), point('b', { recoveredRevenue: 50 })]))).toContain('down 50%');
    expect(monthHeadline(insights([point('a', { newLeads: 4 }), point('b')]))).toContain('quiet');
    expect(monthHeadline(insights([point('a')]))).toBeNull();
  });
});

describe('lists and shares', () => {
  it('draws service rows scaled to the best and title-cased', () => {
    const rows = [{ service: 'hair_cut', leadCount: 10, wonCount: 5, conversionRate: 0.5, revenue: 400 }, { service: 'beard', leadCount: 4, wonCount: 1, conversionRate: 0.25, revenue: 100 }];
    expect(serviceBars(rows, (r) => r.revenue, (v) => `$${v}`)).toEqual([{ label: 'Hair Cut', value: '$400', fraction: 1 }, { label: 'Beard', value: '$100', fraction: 0.25 }]);
  });

  it('turns lifecycle counts into shares that add up to one and skips empty stages', () => {
    const shares = lifecycleShares({ new_lead: 2, loyal: 6, dormant: 2, vip: 0 }, 10);
    expect(shares.map((s) => s.label)).toEqual(['New leads', 'Loyal', 'Slipping away']);
    expect(shares.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
    expect(lifecycleShares({}, 0)).toEqual([]);
  });

  it('formats percentages and missing values', () => { expect(percent(0.456)).toBe('46%'); expect(percent(null)).toBe('-'); });

  it('says how long a lead takes to become a customer, without "0 days"', () => {
    expect(recoveryTimeCopy(0.2)).toBe('On average a lead becomes a customer within a day.');
    expect(recoveryTimeCopy(1.2)).toBe('On average a lead becomes a customer in 1 day.');
    expect(recoveryTimeCopy(3.6)).toBe('On average a lead becomes a customer in 4 days.');
  });
});
