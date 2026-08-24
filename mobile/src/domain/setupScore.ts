import { BusinessDto } from '../apiTypes';
import { AutomationAvailability } from './automation';

export type SetupScoreBusiness = Pick<BusinessDto, 'name' | 'industry' | 'phone' | 'country' | 'googleReviewLink' | 'workingHours' | 'defaultServices' | 'messagingConsentConfirmedAt'>;

export interface SetupScoreInput {
  business: SetupScoreBusiness | null;
  automationAvailability: AutomationAvailability;
  automationConfigured: boolean;
  pushEnabled: boolean;
}
export interface SetupScoreChecklistItem { key: string; label: string; complete: boolean; }
export interface SetupScoreResult { score: number; complete: number; total: number; checklist: SetupScoreChecklistItem[]; }

export function computeSetupScore(input: SetupScoreInput): SetupScoreResult {
  const business = input.business;
  const checklist: SetupScoreChecklistItem[] = [
    { key: 'name', label: 'Business name', complete: Boolean(business?.name?.trim()) },
    { key: 'industry', label: 'Industry', complete: Boolean(business?.industry?.trim()) },
    { key: 'phone', label: 'Business phone', complete: Boolean(business?.phone?.trim()) },
    { key: 'country', label: 'Country', complete: Boolean(business?.country) },
    { key: 'services', label: 'Services', complete: Boolean(business?.defaultServices && business.defaultServices.length > 0) },
    { key: 'googleReview', label: 'Google review link', complete: Boolean(business?.googleReviewLink) },
    { key: 'workingHours', label: 'Working hours', complete: Boolean(business?.workingHours) },
    { key: 'messagingConsent', label: 'Messaging responsibility', complete: Boolean(business?.messagingConsentConfirmedAt) },
    { key: 'notifications', label: 'Notifications enabled', complete: input.pushEnabled },
  ];
  // Automation is Pro-gated, so a business whose plan can't use it yet
  // (or whose availability isn't known yet — 'loading') would always fail
  // this check through no fault of its own. Only score it once availability
  // is confirmed 'available', keeping the score honest instead of
  // penalizing a tier Chakusa itself hasn't unlocked. See
  // PlanExperienceContext for the same plan/status contract.
  if (input.automationAvailability === 'available') {
    checklist.push({ key: 'automation', label: 'Automation', complete: input.automationConfigured });
  }
  const complete = checklist.filter(item => item.complete).length;
  const total = checklist.length;
  const score = total === 0 ? 0 : Math.round((complete / total) * 100);
  return { score, complete, total, checklist };
}
