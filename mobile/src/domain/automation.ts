import { AutomationRuleDto, AutomationRunHistoryItemDto, AutomationRunReason, AutomationRunStatus, SubscriptionStatusValue } from '../apiTypes';

export const AUTOMATION_DELAYS = [0, 60, 120, 300, 600, 900, 1800] as const;
export type AutomationAvailability = 'available' | 'free-locked' | 'subscription-unavailable' | 'loading';
export function automationAvailability(plan: 'FREE' | 'PRO' | 'BUSINESS' | null, status: SubscriptionStatusValue | null, feature: boolean | null): AutomationAvailability { if (plan === null || status === null || feature === null) return 'loading'; if (plan === 'FREE') return 'free-locked'; return feature ? 'available' : 'subscription-unavailable'; }
export function automationStatusCopy(enabled: boolean) { return enabled ? 'Enabled' : 'Disabled'; }
export function delayLabel(seconds: number) { if (seconds === 0) return 'Immediately'; if (seconds === 60) return '1 minute'; return `${Math.round(seconds / 60)} minutes`; }
export function delaySecondsForSelection(seconds: number) { return AUTOMATION_DELAYS.includes(seconds as typeof AUTOMATION_DELAYS[number]) ? seconds : null; }
export function runStatusCopy(status: AutomationRunStatus | string) { return ({ PENDING: 'Scheduled', RUNNING: 'Sending', COMPLETED: 'Sent', FAILED: 'Failed', CANCELLED: 'Canceled' } as Record<string, string>)[status] ?? 'Update unavailable'; }
export function isTerminalRunStatus(status: AutomationRunStatus) { return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(status); }
export function safeAutomationFailureCopy() { return 'Chakusa could not complete this follow-up.'; }
export function canChangeAutomation(availability: AutomationAvailability, rule: AutomationRuleDto | null, nextEnabled: boolean) { return availability === 'available' && Boolean(rule) && rule!.enabled !== nextEnabled; }
export function missedCallRules(rules: AutomationRuleDto[]) { return rules.filter(rule => rule.triggerType === 'LEAD_CREATED' && rule.channel === 'SMS'); }
export function automationReasonCopy(reason: AutomationRunReason | string | null) {
  if (reason === null) return null;
  return ({
    INVALID_PHONE: "The customer's phone number is invalid.",
    CUSTOMER_OPTED_OUT: 'This customer has opted out of SMS messages.',
    SUBSCRIPTION_INACTIVE: 'Automation was unavailable because the subscription was inactive.',
    LEAD_ALREADY_CONTACTED: 'No message was sent because the lead had already been contacted.',
    RULE_DISABLED: 'The automation rule was disabled before this message could be sent.',
    SEND_FAILED: 'The message could not be sent.',
    UNKNOWN: 'This automation could not be completed.',
  } as Record<string, string>)[reason] ?? 'This automation could not be completed.';
}
export function appendUniqueRuns(current: AutomationRunHistoryItemDto[], incoming: AutomationRunHistoryItemDto[]) {
  const known = new Set(current.map(item => item.id));
  return [...current, ...incoming.filter(item => !known.has(item.id))];
}
export function replaceHistoryPage(items: AutomationRunHistoryItemDto[]) { return [...items]; }
export function shouldLoadMoreHistory(itemCount: number, total: number) { return itemCount < total; }
export function historyIsReadable(_availability: AutomationAvailability) { return true; }
export function isDuplicateAutomationRuleConflict(error: { kind?: string; code?: string; message?: string }) {
  return error.kind === 'conflict' && error.code === 'CONFLICT' && /automation rule/i.test(error.message ?? '') && /already exists/i.test(error.message ?? '');
}
export function automationRunTimestamp(run: AutomationRunHistoryItemDto) {
  if (run.status === 'PENDING') return run.scheduledFor;
  if (run.status === 'RUNNING') return run.startedAt ?? run.scheduledFor;
  return run.completedAt ?? run.startedAt ?? run.scheduledFor;
}
