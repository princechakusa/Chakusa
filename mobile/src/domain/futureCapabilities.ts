import type { SubscriptionStatusDto } from '../apiTypes';

// PROGRAM 3 LOOP 1: revenue & entitlement foundation. This is a read-only
// awareness layer over the future capability flags the backend already
// returns in /subscription/status (src/lib/entitlements.ts's placeholder
// Feature keys). It does not gate anything — no route enforces these yet
// — and it never fabricates data: every value comes from the real
// subscription snapshot the account screen already loads.

export type FutureCapabilityKey =
  | 'aiReceptionist'
  | 'quotesEstimates'
  | 'invoicing'
  | 'marketplaceDiscovery'
  | 'accountingIntegrations';

export interface FutureCapability {
  key: FutureCapabilityKey;
  label: string;
  description: string;
}

export const FUTURE_CAPABILITIES: readonly FutureCapability[] = [
  { key: 'aiReceptionist', label: 'AI receptionist', description: 'Chakusa answers and triages calls for you.' },
  { key: 'quotesEstimates', label: 'Quotes & estimates', description: 'Send customers a quote before they book.' },
  { key: 'invoicing', label: 'Invoicing', description: 'Bill and collect payment through Chakusa.' },
  { key: 'marketplaceDiscovery', label: 'Marketplace discovery', description: 'Extra visibility to customers browsing nearby.' },
  { key: 'accountingIntegrations', label: 'Accounting integrations', description: 'Sync bookings and payments to your books.' },
];

/** Whether the account's current plan already includes this future capability. */
export function isCapabilityUnlocked(features: Pick<SubscriptionStatusDto['features'], FutureCapabilityKey>, key: FutureCapabilityKey): boolean {
  return features[key];
}

/** Read-only status copy for a capability row — never a purchase prompt or checkout affordance. */
export function capabilityStatusCopy(features: Pick<SubscriptionStatusDto['features'], FutureCapabilityKey>, key: FutureCapabilityKey): string {
  return isCapabilityUnlocked(features, key) ? 'Included on your plan' : 'Not yet available — coming to Chakusa';
}

/** The capabilities not yet available on the account's current plan, in display order. */
export function lockedCapabilities(features: Pick<SubscriptionStatusDto['features'], FutureCapabilityKey>): FutureCapability[] {
  return FUTURE_CAPABILITIES.filter((capability) => !isCapabilityUnlocked(features, capability.key));
}
