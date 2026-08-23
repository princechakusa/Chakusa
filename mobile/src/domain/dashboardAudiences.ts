import type { AudienceSummaryDto, SmartAudienceKey } from '../apiTypes';

const DASHBOARD_AUDIENCE_ORDER: SmartAudienceKey[] = [
  'outstanding_payments',
  'dormant',
  'needs_reviews',
  'vip',
  'high_value',
  'loyal',
];

export function dashboardAudiences(audiences: AudienceSummaryDto[]): AudienceSummaryDto[] {
  const byKey = new Map(audiences.map(audience => [audience.key, audience]));
  return DASHBOARD_AUDIENCE_ORDER
    .map(key => byKey.get(key))
    .filter((audience): audience is AudienceSummaryDto => Boolean(audience?.totalCustomers));
}

export type DashboardAudienceMetrics =
  | { kind: 'outstanding'; outstandingPayments: number }
  | { kind: 'customerValue'; averageValue: number; repeatRate: number | null };

export function dashboardAudienceMetrics(audience: AudienceSummaryDto): DashboardAudienceMetrics {
  if (audience.key === 'outstanding_payments') {
    return { kind: 'outstanding', outstandingPayments: audience.outstandingPayments };
  }
  return { kind: 'customerValue', averageValue: audience.averageValue, repeatRate: audience.repeatRate };
}
