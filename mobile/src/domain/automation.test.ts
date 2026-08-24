import { describe, expect, it } from 'vitest';
import { AutomationRuleDto, AutomationRunHistoryItemDto } from '../apiTypes';
import { appendUniqueRuns, AUTOMATION_DELAYS, automationAvailability, automationReasonCopy, automationStatusCopy, canChangeAutomation, delayLabel, delaySecondsForSelection, historyIsReadable, isDuplicateAutomationRuleConflict, isTerminalRunStatus, lifecycleAutomationDefinitions, lifecycleRule, missedCallRules, replaceHistoryPage, runStatusCopy, safeAutomationFailureCopy, shouldLoadMoreHistory } from './automation';
const rule = { id: 'rule', businessId: 'business', name: 'Missed-call follow-up', enabled: false, triggerType: 'LEAD_CREATED', channel: 'SMS', delaySeconds: 60, config: {}, createdAt: '', updatedAt: '' } satisfies AutomationRuleDto;
const run = (id: string) => ({ id, status: 'COMPLETED', scheduledFor: '', startedAt: null, completedAt: '', triggerType: 'LEAD_CREATED', channel: 'SMS', customer: null, lead: null, reason: null }) satisfies AutomationRunHistoryItemDto;
describe('automation product rules', () => {
  it('locks FREE even if a stale feature value is true', () => expect(automationAvailability('FREE', 'ACTIVE', true)).toBe('free-locked'));
  it.each([['ACTIVE', true],['TRIALING', true],['GRACE_PERIOD', true],['EXPIRED', false],['CANCELED', false]] as const)('maps PRO %s availability', (status, feature) => expect(automationAvailability('PRO', status, feature)).toBe(feature ? 'available' : 'subscription-unavailable'));
  it('lets the feature flag override the raw PRO plan', () => expect(automationAvailability('PRO', 'ACTIVE', false)).toBe('subscription-unavailable'));
  it('maps enabled state to product copy', () => { expect(automationStatusCopy(true)).toBe('Enabled'); expect(automationStatusCopy(false)).toBe('Disabled'); });
  it.each([[0,'Immediately'],[60,'1 minute'],[120,'2 minutes'],[300,'5 minutes'],[600,'10 minutes'],[900,'15 minutes'],[1800,'30 minutes']] as const)('maps %s seconds to %s', (seconds, label) => { expect(delayLabel(seconds)).toBe(label); expect(delaySecondsForSelection(seconds)).toBe(seconds); });
  it('rejects unsupported delay selections', () => expect(delaySecondsForSelection(75)).toBeNull());
  it.each([['PENDING','Scheduled'],['RUNNING','Sending'],['COMPLETED','Sent'],['FAILED','Failed'],['CANCELLED','Canceled']] as const)('maps run %s to %s', (status, copy) => expect(runStatusCopy(status)).toBe(copy));
  it.each([
    ['INVALID_PHONE', "The customer's phone number is invalid."],
    ['CUSTOMER_OPTED_OUT', 'This customer has opted out of SMS messages.'],
    ['SUBSCRIPTION_INACTIVE', 'Automation was unavailable because the subscription was inactive.'],
    ['LEAD_ALREADY_CONTACTED', 'No message was sent because the lead had already been contacted.'],
    ['RULE_DISABLED', 'The automation rule was disabled before this message could be sent.'],
    ['SEND_FAILED', 'The message could not be sent.'],
    ['UNKNOWN', 'This automation could not be completed.'],
  ] as const)('maps reason %s safely', (reason, copy) => expect(automationReasonCopy(reason)).toBe(copy));
  it('omits a null reason', () => expect(automationReasonCopy(null)).toBeNull());
  it('fails safely for future status and reason values', () => { expect(runStatusCopy('FUTURE')).toBe('Update unavailable'); expect(automationReasonCopy('FUTURE')).toBe('This automation could not be completed.'); });
  it('appends pagination without duplicate run ids', () => expect(appendUniqueRuns([run('one')], [run('one'), run('two')]).map(item => item.id)).toEqual(['one', 'two']));
  it('refresh replaces page-one state authoritatively', () => expect(replaceHistoryPage([run('new')])).toEqual([run('new')]));
  it.each(['available', 'free-locked', 'subscription-unavailable'] as const)('keeps history readable for %s access', availability => expect(historyIsReadable(availability)).toBe(true));
  it('recognizes only the duplicate-rule conflict contract', () => { expect(isDuplicateAutomationRuleConflict({ kind: 'conflict', code: 'CONFLICT', message: 'An automation rule for LEAD_CREATED on SMS already exists for this business' })).toBe(true); expect(isDuplicateAutomationRuleConflict({ kind: 'conflict', code: 'CONFLICT', message: 'Another conflict' })).toBe(false); expect(isDuplicateAutomationRuleConflict({ kind: 'server', code: 'CONFLICT', message: 'An automation rule already exists' })).toBe(false); });
  it('derives empty and load-more states from totals', () => { expect(shouldLoadMoreHistory(0, 0)).toBe(false); expect(shouldLoadMoreHistory(24, 25)).toBe(true); expect(shouldLoadMoreHistory(25, 25)).toBe(false); });
  it('maps terminal history states', () => { expect(isTerminalRunStatus('COMPLETED')).toBe(true); expect(isTerminalRunStatus('FAILED')).toBe(true); expect(isTerminalRunStatus('CANCELLED')).toBe(true); expect(isTerminalRunStatus('RUNNING')).toBe(false); });
  it('uses safe failure copy without exposing backend text', () => expect(safeAutomationFailureCopy()).toBe('Chakusa could not complete this follow-up.'));
  it('allows only real state changes for entitled rules', () => { expect(canChangeAutomation('available', rule, true)).toBe(true); expect(canChangeAutomation('free-locked', rule, true)).toBe(false); expect(canChangeAutomation('available', { ...rule, enabled: true }, true)).toBe(false); });
  it('selects only missed-call SMS rules', () => expect(missedCallRules([rule, { ...rule, id: 'other', triggerType: 'LEAD_FOLLOW_UP' }])).toEqual([rule]));
  it('defines the existing lifecycle engines with deterministic repository inputs', () => {
    const definitions = lifecycleAutomationDefinitions(30);
    expect(definitions.map(item => item.triggerType)).toEqual(['LEAD_FOLLOW_UP', 'CUSTOMER_RETENTION']);
    expect(definitions[0].delaySeconds).toBe(86_400);
    expect(definitions[1].config).toEqual({ minDaysSinceVisit: 30 });
  });
  it('selects a lifecycle SMS rule by trigger', () => {
    const followUp = { ...rule, id: 'follow-up', triggerType: 'LEAD_FOLLOW_UP' as const };
    expect(lifecycleRule([rule, followUp], 'LEAD_FOLLOW_UP')).toEqual(followUp);
    expect(lifecycleRule([rule], 'CUSTOMER_RETENTION')).toBeNull();
  });
  it('keeps the supported delay set exact', () => expect(AUTOMATION_DELAYS).toEqual([0,60,120,300,600,900,1800]));
});
