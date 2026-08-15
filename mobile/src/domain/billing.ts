import { SubscriptionStatusDto, SubscriptionStatusValue } from '../apiTypes';

export type BillingPlatform = 'ios' | 'android' | 'web' | 'unsupported';
export type BillingErrorKind = 'canceled' | 'pending' | 'already-owned' | 'product-unavailable' | 'store-unavailable' | 'network' | 'verification' | 'conflict' | 'unknown';
export const BILLING_LEGAL_LINKS = ['https://chakusa.com/terms', 'https://chakusa.com/privacy'] as const;

export function isEntitledStatus(status: SubscriptionStatusValue | null) { return status === 'ACTIVE' || status === 'TRIALING' || status === 'GRACE_PERIOD'; }
export function canSubscribe(plan: 'FREE' | 'PRO' | 'BUSINESS' | null, status: SubscriptionStatusValue | null) { return plan !== 'BUSINESS' && (plan === 'FREE' || status === 'EXPIRED' || status === 'CANCELED'); }
export function canNativeSubscribe(platform: BillingPlatform) { return platform === 'ios' || platform === 'android'; }
export function checkoutPrice(displayPrice?: string | null) { return displayPrice?.trim() || null; }
export function subscriptionStatusLabel(subscription: Pick<SubscriptionStatusDto, 'status'|'cancelAtPeriodEnd'|'currentPeriodEnd'>) {
  if (subscription.status === 'ACTIVE' && subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd) return `Active until ${formatBillingDate(subscription.currentPeriodEnd)}`;
  return ({ ACTIVE: 'Active', TRIALING: 'Trial', GRACE_PERIOD: 'Payment issue', EXPIRED: 'Expired', CANCELED: 'Canceled' } as const)[subscription.status];
}
export function subscriptionPeriodCopy(subscription: Pick<SubscriptionStatusDto, 'status'|'cancelAtPeriodEnd'|'currentPeriodEnd'|'trialEndsAt'>) {
  if (subscription.status === 'TRIALING' && subscription.trialEndsAt) return `Trial ends ${formatBillingDate(subscription.trialEndsAt)}`;
  if (!subscription.currentPeriodEnd) return null;
  return `${subscription.cancelAtPeriodEnd ? 'Access until' : 'Renews on'} ${formatBillingDate(subscription.currentPeriodEnd)}`;
}
export function formatBillingDate(value: string) { return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(value)); }
export function billingErrorKind(code?: string, backendConflict = false): BillingErrorKind {
  if (backendConflict) return 'conflict';
  if (code === 'user-cancelled') return 'canceled';
  if (code === 'pending' || code === 'deferred-payment') return 'pending';
  if (code === 'already-owned' || code === 'duplicate-purchase') return 'already-owned';
  if (code === 'item-unavailable' || code === 'sku-not-found' || code === 'empty-sku-list') return 'product-unavailable';
  if (code === 'billing-unavailable' || code === 'iap-not-available' || code === 'service-disconnected') return 'store-unavailable';
  if (code === 'network-error' || code === 'service-timeout') return 'network';
  return 'unknown';
}
export function billingMessage(kind: BillingErrorKind) {
  return ({ canceled: null, pending: 'Your purchase is pending approval from the store.', 'already-owned': 'This subscription is already owned. Use Restore Purchases to connect it.', 'product-unavailable': 'Chakusa Pro is not available from this store account right now.', 'store-unavailable': 'The store is unavailable. Please try again.', network: 'Couldn’t reach the store. Check your connection and try again.', verification: 'Your purchase was received, but Chakusa could not confirm it yet.', conflict: 'This subscription is already connected to another Chakusa business.', unknown: 'The purchase could not be completed. Please try again.' } as const)[kind];
}
export function productConfigured(platform: BillingPlatform, appleId: string, googleId: string) { return platform === 'ios' ? Boolean(appleId) : platform === 'android' ? Boolean(googleId) : false; }
export function productIdForPlatform(platform: BillingPlatform, appleId: string, googleId: string) { return platform === 'ios' ? appleId : platform === 'android' ? googleId : ''; }
export function verifyPayload(platform: BillingPlatform, proof: string) { return platform === 'ios' ? { transactionId: proof } : { purchaseToken: proof }; }
