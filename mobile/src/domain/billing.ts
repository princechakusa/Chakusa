import { SubscriptionStatusDto, SubscriptionStatusValue } from '../apiTypes';

export type BillingPlatform = 'ios' | 'android' | 'web' | 'unsupported';
export type BillingPlan = 'STARTER' | 'PRO' | 'BUSINESS';
export type ServerPlan = 'FREE' | BillingPlan;
export type BillingErrorKind = 'canceled' | 'pending' | 'already-owned' | 'product-unavailable' | 'store-unavailable' | 'network' | 'verification' | 'conflict' | 'unknown';

/** Lowest to highest; mirrors the API's PLAN_ORDER (src/lib/entitlements.ts). */
export const PLAN_ORDER: readonly ServerPlan[] = ['FREE', 'STARTER', 'PRO', 'BUSINESS'];
export const BILLING_PLANS: readonly BillingPlan[] = ['STARTER', 'PRO', 'BUSINESS'];
export const planRank = (plan: ServerPlan | null) => (plan ? PLAN_ORDER.indexOf(plan) : 0);
export const planName = (plan: ServerPlan | null) => ({ FREE: 'Free', STARTER: 'Starter', PRO: 'Pro', BUSINESS: 'Business' } as const)[plan ?? 'FREE'];

export function isEntitledStatus(status: SubscriptionStatusValue | null) { return status === 'ACTIVE' || status === 'TRIALING' || status === 'GRACE_PERIOD'; }

/** The plan someone actually has the benefit of right now (an expired Pro is Free). */
export function effectivePlan(plan: ServerPlan | null, status: SubscriptionStatusValue | null): ServerPlan { return plan && plan !== 'FREE' && isEntitledStatus(status) ? plan : 'FREE'; }

/**
 * What the button on a plan card does. New subscribers and upgrades buy in
 * the app; a downgrade is a store-managed change (both stores apply it at the
 * next renewal), so it opens the store's subscription settings.
 */
export type PlanAction = 'current' | 'subscribe' | 'upgrade' | 'downgrade';
export function planAction(plan: ServerPlan | null, status: SubscriptionStatusValue | null, target: BillingPlan): PlanAction {
  const current = effectivePlan(plan, status);
  if (current === target) return 'current';
  if (current === 'FREE') return 'subscribe';
  return planRank(target) > planRank(current) ? 'upgrade' : 'downgrade';
}
/** One-line plan summary for menus: "Pro", "Starter trial", "Pro - payment issue", "Free". */
export function planSummary(plan: ServerPlan | null, status: SubscriptionStatusValue | null): string {
  const current = effectivePlan(plan, status);
  if (current === 'FREE') return plan && plan !== 'FREE' ? 'Free (subscription ended)' : 'Free';
  if (status === 'TRIALING') return `${planName(current)} trial`;
  if (status === 'GRACE_PERIOD') return `${planName(current)} - payment issue`;
  return planName(current);
}
export function canNativeSubscribe(platform: BillingPlatform) { return platform === 'ios' || platform === 'android'; }
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
  return ({ canceled: null, pending: 'Your purchase is pending approval from the store.', 'already-owned': 'This subscription is already owned. Use Restore Purchases to connect it.', 'product-unavailable': 'This plan is not available from this store account right now.', 'store-unavailable': 'The store is unavailable. Please try again.', network: 'Couldn’t reach the store. Check your connection and try again.', verification: 'Your purchase was received, but Chakusa could not confirm it yet.', conflict: 'This subscription is already connected to another Chakusa business.', unknown: 'The purchase could not be completed. Please try again.' } as const)[kind];
}
export function productIdForPlatform(platform: BillingPlatform, appleId: string, googleId: string) { return platform === 'ios' ? appleId : platform === 'android' ? googleId : ''; }

type AndroidOffer = { offerTokenAndroid?: string | null; pricingPhasesAndroid?: { pricingPhaseList: { priceAmountMicros: string }[] } | null };

/** Google Play lists only the offers this customer is eligible for; prefer one with a free phase (the trial), else the base plan. */
export function androidOfferToken(offers: AndroidOffer[] | null | undefined) {
  const usable = (offers ?? []).filter((offer) => offer.offerTokenAndroid);
  const trial = usable.find((offer) => offer.pricingPhasesAndroid?.pricingPhaseList.some((phase) => Number(phase.priceAmountMicros) === 0));
  return (trial ?? usable[0])?.offerTokenAndroid ?? undefined;
}
