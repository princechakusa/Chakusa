import { describe, expect, it } from 'vitest';
import { billingErrorKind, billingMessage, canNativeSubscribe, effectivePlan, isEntitledStatus, planAction, planName, planRank, subscriptionPeriodCopy, subscriptionStatusLabel } from './billing';

const subscription = { status: 'ACTIVE' as const, cancelAtPeriodEnd: false, currentPeriodEnd: '2026-08-30T00:00:00.000Z', trialEndsAt: null };
describe('native billing product rules', () => {
  it('orders plans and names them', () => { expect(planRank('FREE')).toBeLessThan(planRank('STARTER')); expect(planRank('STARTER')).toBeLessThan(planRank('PRO')); expect(planRank('PRO')).toBeLessThan(planRank('BUSINESS')); expect(planName('STARTER')).toBe('Starter'); expect(planName(null)).toBe('Free'); });
  it('treats an expired or canceled plan as Free', () => { expect(effectivePlan('PRO', 'EXPIRED')).toBe('FREE'); expect(effectivePlan('PRO', 'GRACE_PERIOD')).toBe('PRO'); expect(effectivePlan(null, null)).toBe('FREE'); });
  it('offers subscribe on Free, upgrade above, and a store-managed switch below the current plan', () => {
    expect(planAction('FREE', 'ACTIVE', 'STARTER')).toBe('subscribe');
    expect(planAction('STARTER', 'ACTIVE', 'STARTER')).toBe('current');
    expect(planAction('STARTER', 'TRIALING', 'PRO')).toBe('upgrade');
    expect(planAction('PRO', 'ACTIVE', 'BUSINESS')).toBe('upgrade');
    expect(planAction('BUSINESS', 'ACTIVE', 'STARTER')).toBe('downgrade');
    expect(planAction('PRO', 'EXPIRED', 'PRO')).toBe('subscribe');
    expect(planAction('PRO', 'CANCELED', 'STARTER')).toBe('subscribe');
  });
  it.each(['ACTIVE','TRIALING','GRACE_PERIOD'] as const)('treats %s as entitled', status => expect(isEntitledStatus(status)).toBe(true));
  it('handles cancellation as a non-error and maps store failures', () => { expect(billingErrorKind('user-cancelled')).toBe('canceled'); expect(billingMessage('canceled')).toBeNull(); expect(billingErrorKind('billing-unavailable')).toBe('store-unavailable'); expect(billingErrorKind('pending')).toBe('pending'); });
  it('maps already-owned and cross-business conflict safely', () => { expect(billingErrorKind('already-owned')).toBe('already-owned'); expect(billingErrorKind(undefined, true)).toBe('conflict'); expect(billingMessage('conflict')).not.toContain('business ID'); });
  it('formats cancellation, renewal, and trial server truth', () => { expect(subscriptionStatusLabel({ ...subscription, cancelAtPeriodEnd: true })).toContain('Active until'); expect(subscriptionPeriodCopy(subscription)).toContain('Renews on'); expect(subscriptionPeriodCopy({ ...subscription, status: 'TRIALING', trialEndsAt: '2026-08-20T00:00:00.000Z' })).toContain('Trial ends'); });
  it('allows native purchase only on iOS and Android', () => { expect(canNativeSubscribe('ios')).toBe(true); expect(canNativeSubscribe('android')).toBe(true); expect(canNativeSubscribe('web')).toBe(false); });
});
