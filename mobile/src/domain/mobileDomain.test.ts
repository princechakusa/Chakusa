import { describe, expect, it } from 'vitest';
import { clearPlanSnapshot, displayLimit, getAllowedLeadTransitions, mapEntitlementError, subscriptionStatusCopy } from './mobileDomain';
describe('mobile domain rules', () => {
  it.each([['new', ['contacted','won','lost']], ['contacted', ['booked','won','lost']], ['booked', ['won','lost']], ['won', []], ['lost', []]] as const)('maps %s transitions', (status, expected) => expect(getAllowedLeadTransitions(status)).toEqual(expected));
  it('maps plan limits and entitlement errors', () => { expect(displayLimit(null)).toBe('Unlimited'); expect(displayLimit(40)).toBe('40'); expect(mapEntitlementError('LIMIT_REACHED', { limit: 40 })?.body).toContain('40'); expect(mapEntitlementError('FEATURE_NOT_AVAILABLE')?.title).toContain('Pro'); });
  it('clears account plan state', () => expect(clearPlanSnapshot()).toBeNull());
  it.each([['ACTIVE','Active'],['TRIALING','Trial'],['GRACE_PERIOD','Payment issue'],['EXPIRED','Expired'],['CANCELED','Canceled']] as const)('maps %s copy', (status, expected) => expect(subscriptionStatusCopy(status)).toBe(expected));
});
