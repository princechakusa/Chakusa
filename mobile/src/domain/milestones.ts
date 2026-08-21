import type { DashboardSummaryDto } from '../apiTypes';
import type { RecoveryEngineOverall } from './recoveryEngineStatus';

export type MilestoneKey = 'recovery_engine_ready' | 'first_lead_recovered' | 'first_customer_won' | 'first_review_sent' | 'first_returning_customer';

export interface Milestone { key: MilestoneKey; title: string; message: string; }

const COPY: Record<MilestoneKey, Omit<Milestone, 'key'>> = {
  recovery_engine_ready: { title: 'Recovery Engine ready', message: 'Chakusa is now watching for missed calls and following up automatically — you don’t have to remember to check.' },
  first_lead_recovered: { title: 'First opportunity recovered', message: 'Chakusa caught your first customer opportunity. This is what the Recovery Engine does, every time.' },
  first_customer_won: { title: 'First customer won', message: 'You just turned a recovered opportunity into real business.' },
  first_review_sent: { title: 'First review requested', message: 'You’re building your reputation — every completed job is now a chance for a public review.' },
  first_returning_customer: { title: 'First returning customer', message: 'A customer came back because Chakusa reminded them. That’s the whole point.' },
};

export function milestoneCopy(key: MilestoneKey): Milestone {
  return { key, ...COPY[key] };
}

/**
 * Pure "did we just cross the line" check — a milestone counts once the
 * underlying count is exactly 1, never re-fires for 2+. Dashboard totals
 * are the source of truth (not a per-action check), so this covers a lead
 * arriving from *any* source — manual entry or the automated call
 * detector — without needing separate wiring in every screen that can
 * create one.
 */
export function dashboardMilestones(dashboard: Pick<DashboardSummaryDto, 'leads' | 'reviews' | 'recoveredRevenue'>): MilestoneKey[] {
  const reached: MilestoneKey[] = [];
  if (dashboard.leads.total === 1) reached.push('first_lead_recovered');
  if (dashboard.leads.won === 1) reached.push('first_customer_won');
  if (dashboard.reviews.requestsSent === 1) reached.push('first_review_sent');
  if (dashboard.recoveredRevenue.comebackCompletedCount === 1) reached.push('first_returning_customer');
  return reached;
}

/** The engine-readiness milestone is judged the moment the owner reaches a fully active status, not off any count. */
export function recoveryEngineReadyMilestone(overall: RecoveryEngineOverall): MilestoneKey[] {
  return overall === 'active' ? ['recovery_engine_ready'] : [];
}

/** Filters a set of newly-reached milestones down to ones this device has never shown before. */
export function unseenMilestones(reached: MilestoneKey[], seen: ReadonlySet<string>): MilestoneKey[] {
  return reached.filter(key => !seen.has(key));
}
