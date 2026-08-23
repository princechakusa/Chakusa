import { describe, expect, it } from 'vitest';
import type { AudienceSummaryDto, SmartAudienceKey } from '../apiTypes';
import { dashboardAudienceMetrics, dashboardAudiences } from './dashboardAudiences';

function audience(key: SmartAudienceKey, totalCustomers: number): AudienceSummaryDto {
  return { key, label: key, customerIds: [], totalCustomers, averageValue: 100, repeatRate: 0.5, revenue: 100, outstandingPayments: 0 };
}

describe('Dashboard audience summary', () => {
  it('shows only non-empty dashboard audiences in action-first order', () => {
    const result = dashboardAudiences([
      audience('loyal', 2),
      audience('new', 8),
      audience('dormant', 3),
      audience('outstanding_payments', 1),
      audience('vip', 0),
    ]);

    expect(result.map(item => item.key)).toEqual(['outstanding_payments', 'dormant', 'loyal']);
  });

  it('returns no cards when every relevant audience is empty', () => {
    expect(dashboardAudiences([audience('vip', 0), audience('high_value', 0)])).toEqual([]);
  });

  it('uses only existing Audience Engine metrics for card value details', () => {
    expect(dashboardAudienceMetrics({ ...audience('outstanding_payments', 2), outstandingPayments: 450 })).toEqual({ kind: 'outstanding', outstandingPayments: 450 });
    expect(dashboardAudienceMetrics({ ...audience('loyal', 3), averageValue: 800, repeatRate: 0.75 })).toEqual({ kind: 'customerValue', averageValue: 800, repeatRate: 0.75 });
  });
});
