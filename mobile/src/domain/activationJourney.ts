import type { DashboardSummaryDto } from '../apiTypes';

export type ActivationDestination = 'Customers' | 'Leads' | 'Reviews';
export interface ActivationStep { key: string; label: string; action: string; destination: ActivationDestination; complete: boolean; }
export interface ActivationJourney { steps: ActivationStep[]; complete: number; total: number; next: ActivationStep | null; }

export function activationJourney(dashboard: DashboardSummaryDto): ActivationJourney {
  const leadsProgressed = dashboard.leads.contacted + dashboard.leads.booked + dashboard.leads.won;
  const steps: ActivationStep[] = [
    { key: 'customer', label: 'Add your first customer', action: 'Add customer', destination: 'Customers', complete: dashboard.customerIntelligence.totalCustomers > 0 },
    { key: 'lead', label: 'Capture your first opportunity', action: 'Add lead', destination: 'Leads', complete: dashboard.leads.total > 0 },
    { key: 'follow_up', label: 'Follow up with a lead', action: 'Follow up', destination: 'Leads', complete: leadsProgressed > 0 },
    { key: 'won', label: 'Record your first won job', action: 'Record win', destination: 'Leads', complete: dashboard.leads.won > 0 },
    { key: 'review', label: 'Request your first review', action: 'Request review', destination: 'Reviews', complete: dashboard.reviews.requestsSent > 0 },
  ];
  const complete = steps.filter(step => step.complete).length;
  return { steps, complete, total: steps.length, next: steps.find(step => !step.complete) ?? null };
}
