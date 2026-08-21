import { AutomationRuleDto } from '../apiTypes';
import { isDuplicateAutomationRuleConflict, missedCallRules } from '../domain/automation';
import { ApiError } from './api';
import { automationApi } from './endpoints';

export interface EnsureMissedCallRuleResult { rules: AutomationRuleDto[]; alreadyExisted: boolean; }

// Shared by AutomationScreen and the onboarding automation step so both
// "set up my first missed-call rule" flows agree on one behavior: check for
// an existing rule first, create if absent, and treat a create-time
// duplicate-rule conflict (a concurrent create from another device/tab) the
// same as if it had already existed.
export async function ensureMissedCallAutomationRule(delaySeconds: number): Promise<EnsureMissedCallRuleResult> {
  const latest = await automationApi.listRules();
  if (missedCallRules(latest).length) return { rules: latest, alreadyExisted: true };
  try {
    await automationApi.createRule({ name: 'Missed-call follow-up', enabled: false, triggerType: 'LEAD_CREATED', channel: 'SMS', delaySeconds, config: {} });
  } catch (caught) {
    if (!isDuplicateAutomationRuleConflict(caught instanceof ApiError ? caught : {})) throw caught;
    return { rules: await automationApi.listRules(), alreadyExisted: true };
  }
  return { rules: await automationApi.listRules(), alreadyExisted: false };
}
