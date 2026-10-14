import type { SubscriptionStatusDto } from '../apiTypes';

// PROGRAM 3 LOOP 1: revenue & entitlement foundation. This is a read-only
// awareness layer over the future capability flags the backend already
// returns in /subscription/status (src/lib/entitlements.ts's placeholder
// Feature keys). It does not gate anything - no route enforces these yet
// - and it never fabricates data: every value comes from the real
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
  /** The business-app screen where the capability is used. */
  route: 'AiReceptionist' | 'Quotes' | 'Invoices' | 'BusinessSettings' | 'AccountingExport';
}

export const FUTURE_CAPABILITIES: readonly FutureCapability[] = [
  { key: 'aiReceptionist', label: 'AI receptionist', description: 'Answers customer messages for you, by SMS and WhatsApp.', route: 'AiReceptionist' },
  { key: 'quotesEstimates', label: 'Quotes & estimates', description: 'Send customers a quote they can accept online.', route: 'Quotes' },
  { key: 'invoicing', label: 'Invoicing', description: 'Bill customers and collect card payments.', route: 'Invoices' },
  { key: 'marketplaceDiscovery', label: 'Marketplace discovery', description: 'Customers nearby find and book you in Explore. Pin your location in Business settings.', route: 'BusinessSettings' },
  { key: 'accountingIntegrations', label: 'Accounting export', description: 'Download invoices and payments for QuickBooks, Xero or your accountant.', route: 'AccountingExport' },
];

/** Whether the account's current plan already includes this future capability. */
export function isCapabilityUnlocked(features: Pick<SubscriptionStatusDto['features'], FutureCapabilityKey>, key: FutureCapabilityKey): boolean {
  return features[key];
}

/** Read-only status copy for a capability row - never a purchase prompt or checkout affordance. */
export function capabilityStatusCopy(features: Pick<SubscriptionStatusDto['features'], FutureCapabilityKey>, key: FutureCapabilityKey): string {
  return isCapabilityUnlocked(features, key) ? 'Included on your plan' : 'Available on Chakusa Business';
}

/** The capabilities not yet available on the account's current plan, in display order. */
export function lockedCapabilities(features: Pick<SubscriptionStatusDto['features'], FutureCapabilityKey>): FutureCapability[] {
  return FUTURE_CAPABILITIES.filter((capability) => !isCapabilityUnlocked(features, capability.key));
}
