import { AutomationChannel, AutomationRuleDto } from '../apiTypes';
import { isDuplicateAutomationRuleConflict, missedCallRules } from '../domain/automation';
import { ApiError } from './api';
import { automationApi } from './endpoints';

export interface EnsureMissedCallRuleResult { rules: AutomationRuleDto[]; alreadyExisted: boolean; }

// Shared by AutomationScreen and the onboarding automation step so both
// "set up my first missed-call rule" flows agree on one behavior: check for
// an existing rule first, create if absent, and treat a create-time
// duplicate-rule conflict (a concurrent create from another device/tab) the
// same as if it had already existed.
export async function ensureMissedCallAutomationRule(delaySeconds: number, channel: AutomationChannel = 'SMS'): Promise<EnsureMissedCallRuleResult> {
  const latest = await automationApi.listRules();
  if (missedCallRules(latest).length) return { rules: latest, alreadyExisted: true };
  try {
    await automationApi.createRule({ name: 'Missed-call follow-up', enabled: false, triggerType: 'LEAD_CREATED', channel, delaySeconds, config: {} });
  } catch (caught) {
    if (!isDuplicateAutomationRuleConflict(caught instanceof ApiError ? caught : {})) throw caught;
    return { rules: await automationApi.listRules(), alreadyExisted: true };
  }
  return { rules: await automationApi.listRules(), alreadyExisted: false };
}

/**
 * Turns the missed-call follow-up on or off for one channel. SMS and WhatsApp
 * are independent rules (one per channel); a channel being switched on for
 * the first time gets its rule created already enabled, at `delaySeconds`.
 */
export async function setMissedCallChannel(channel: AutomationChannel, enabled: boolean, delaySeconds: number) {
  const findRule = (rules: Awaited<ReturnType<typeof automationApi.listRules>>) => missedCallRules(rules).find(rule => rule.channel === channel);
  let existing = findRule(await automationApi.listRules());
  if (!existing && enabled) {
    try {
      await automationApi.createRule({ name: `Missed-call ${channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'} follow-up`, enabled: true, triggerType: 'LEAD_CREATED', channel, delaySeconds, config: {} });
      return;
    } catch (caught) {
      if (!isDuplicateAutomationRuleConflict(caught instanceof ApiError ? caught : {})) throw caught;
      existing = findRule(await automationApi.listRules());
    }
  }
  if (!existing || existing.enabled === enabled) return;
  await (enabled ? automationApi.enableRule(existing.id) : automationApi.disableRule(existing.id));
}
