import { describe, expect, it } from 'vitest';
import type { DashboardSummaryDto } from '../apiTypes';
import { activationJourney } from './activationJourney';

function dashboard(overrides: Partial<DashboardSummaryDto> = {}): DashboardSummaryDto {
  return {
    recoveredRevenue: { total: 0, missedCall: 0, comebackCompletedCount: 0, outstanding: 0 },
    businessHealth: { score: null, label: null, factors: [] },
    customerIntelligence: { totalCustomers: 0, newCustomersThisPeriod: 0, customersWithWonLead: 0, returningCustomers: 0, repeatCustomerRate: null, averageLifetimeValue: null, averageRecoveryDays: null, needingFollowUp: [], needingFollowUpTotalCount: 0, topCustomersByValue: [] },
    recommendations: [], leads: { missedCalls: 0, new: 0, contacted: 0, booked: 0, won: 0, lost: 0, total: 0, conversionRate: 0, contactRate: 0 },
    reviews: { requestsSent: 0, reviewsReceived: 0, feedbackReceived: 0 }, customersDue: 0, responseTime: { averageSeconds: null, sampleSize: 0 }, recentActivity: [], todayAttentionItems: [], generatedAt: '', windowStart: '', ...overrides,
  };
}

describe('activation journey', () => {
  it('starts with a bookable service and gives a concrete action', () => { const result = activationJourney(dashboard()); expect(result.complete).toBe(0); expect(result.next).toMatchObject({ key: 'service', destination: { kind: 'root', screen: 'ServiceCatalog' }, action: 'Set up service' }); });
  it('advances only from deterministic booking-to-result evidence', () => { const result = activationJourney(dashboard({ activation: { activePublicServices: 1, appointmentsBooked: 1, appointmentsCompleted: 1, appointmentsPaid: 1, customerMessagesSent: 1 }, reviews: { requestsSent: 1, reviewsReceived: 1, feedbackReceived: 0 } })); expect(result.complete).toBe(6); expect(result.next).toBeNull(); });
  it('does not mistake a booking for a completed appointment', () => { const result = activationJourney(dashboard({ activation: { activePublicServices: 1, appointmentsBooked: 1, appointmentsCompleted: 0, appointmentsPaid: 0, customerMessagesSent: 0 } })); expect(result.next?.key).toBe('completed'); });
  it('does not count a requested review as an earned review', () => { const result = activationJourney(dashboard({ activation: { activePublicServices: 1, appointmentsBooked: 1, appointmentsCompleted: 1, appointmentsPaid: 1, customerMessagesSent: 1 }, reviews: { requestsSent: 1, reviewsReceived: 0, feedbackReceived: 0 } })); expect(result.next?.key).toBe('review'); });
});
