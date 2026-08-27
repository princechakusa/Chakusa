import { describe, expect, it } from 'vitest';
import { BILLING_LEGAL_LINKS, billingErrorKind, billingMessage, canNativeSubscribe, canPurchasePlan, canSubscribe, checkoutPrice, isEntitledStatus, productConfigured, subscriptionPeriodCopy, subscriptionStatusLabel, verifyPayload } from './billing';

const subscription = { status: 'ACTIVE' as const, cancelAtPeriodEnd: false, currentPeriodEnd: '2026-08-30T00:00:00.000Z', trialEndsAt: null };
describe('native billing product rules', () => {
  it('shows subscribe for FREE and expired/canceled, but not active Pro', () => { expect(canSubscribe('FREE', 'ACTIVE')).toBe(true); expect(canSubscribe('PRO', 'ACTIVE')).toBe(false); expect(canSubscribe('PRO', 'EXPIRED')).toBe(true); expect(canSubscribe('PRO', 'CANCELED')).toBe(true); });
  it('allows a Pro owner to upgrade to Business without offering duplicate Pro', () => { expect(canPurchasePlan('PRO', 'ACTIVE', 'BUSINESS')).toBe(true); expect(canPurchasePlan('PRO', 'ACTIVE', 'PRO')).toBe(false); expect(canPurchasePlan('FREE', 'ACTIVE', 'PRO')).toBe(true); expect(canPurchasePlan('FREE', 'ACTIVE', 'BUSINESS')).toBe(true); expect(canPurchasePlan('BUSINESS', 'ACTIVE', 'PRO')).toBe(false); });
  it.each(['ACTIVE','TRIALING','GRACE_PERIOD'] as const)('treats %s as entitled', status => expect(isEntitledStatus(status)).toBe(true));
  it('uses the localized store display price without constructing a currency', () => { expect(checkoutPrice('AED 109.99')).toBe('AED 109.99'); expect(checkoutPrice(null)).toBeNull(); expect(checkoutPrice('$29')).not.toBe('$29/month'); });
  it('keeps legal links available and auto-renew disclosure stable', () => expect(BILLING_LEGAL_LINKS).toEqual(['https://chakusa.com/terms','https://chakusa.com/privacy']));
  it('creates proof-only provider payloads', () => { expect(verifyPayload('ios', 'tx')).toEqual({ transactionId: 'tx' }); expect(verifyPayload('android', 'token')).toEqual({ purchaseToken: 'token' }); expect(verifyPayload('ios', 'tx')).not.toHaveProperty('plan'); });
  it('handles cancellation as a non-error and maps store failures', () => { expect(billingErrorKind('user-cancelled')).toBe('canceled'); expect(billingMessage('canceled')).toBeNull(); expect(billingErrorKind('billing-unavailable')).toBe('store-unavailable'); expect(billingErrorKind('pending')).toBe('pending'); });
  it('maps already-owned and cross-business conflict safely', () => { expect(billingErrorKind('already-owned')).toBe('already-owned'); expect(billingErrorKind(undefined, true)).toBe('conflict'); expect(billingMessage('conflict')).not.toContain('business ID'); });
  it('formats cancellation, renewal, and trial server truth', () => { expect(subscriptionStatusLabel({ ...subscription, cancelAtPeriodEnd: true })).toContain('Active until'); expect(subscriptionPeriodCopy(subscription)).toContain('Renews on'); expect(subscriptionPeriodCopy({ ...subscription, status: 'TRIALING', trialEndsAt: '2026-08-20T00:00:00.000Z' })).toContain('Trial ends'); });
  it('allows native purchase only on iOS and Android', () => { expect(canNativeSubscribe('ios')).toBe(true); expect(canNativeSubscribe('android')).toBe(true); expect(canNativeSubscribe('web')).toBe(false); });
  it('requires the platform product id and never fabricates one', () => { expect(productConfigured('ios', '', 'google')).toBe(false); expect(productConfigured('android', 'apple', '')).toBe(false); });
});
