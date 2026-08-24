import type { DashboardSummaryDto } from '../apiTypes';

export type ActivationDestination =
  | { kind: 'tab'; screen: 'Calendar' | 'Reviews' }
  | { kind: 'root'; screen: 'ServiceCatalog' };
export interface ActivationStep { key: string; label: string; action: string; destination: ActivationDestination; complete: boolean; }
export interface ActivationJourney { steps: ActivationStep[]; complete: number; total: number; next: ActivationStep | null; }

export function activationJourney(dashboard: DashboardSummaryDto): ActivationJourney {
  const evidence = dashboard.activation ?? { activePublicServices: 0, appointmentsBooked: 0, appointmentsCompleted: 0, appointmentsPaid: 0, customerMessagesSent: 0 };
  const steps: ActivationStep[] = [
    { key: 'service', label: 'Publish your first bookable service', action: 'Set up service', destination: { kind: 'root', screen: 'ServiceCatalog' }, complete: evidence.activePublicServices > 0 },
    { key: 'booking', label: 'Receive your first appointment', action: 'Open calendar', destination: { kind: 'tab', screen: 'Calendar' }, complete: evidence.appointmentsBooked > 0 },
    { key: 'completed', label: 'Complete your first appointment', action: 'Manage appointment', destination: { kind: 'tab', screen: 'Calendar' }, complete: evidence.appointmentsCompleted > 0 },
    { key: 'paid', label: 'Record your first payment', action: 'Record payment', destination: { kind: 'tab', screen: 'Calendar' }, complete: evidence.appointmentsPaid > 0 },
    { key: 'message', label: 'Send your first customer update', action: 'Open calendar', destination: { kind: 'tab', screen: 'Calendar' }, complete: evidence.customerMessagesSent > 0 },
    { key: 'review', label: 'Earn your first customer review', action: 'Request review', destination: { kind: 'tab', screen: 'Reviews' }, complete: dashboard.reviews.reviewsReceived > 0 },
  ];
  const complete = steps.filter(step => step.complete).length;
  return { steps, complete, total: steps.length, next: steps.find(step => !step.complete) ?? null };
}
