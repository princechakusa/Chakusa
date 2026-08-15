import { requireAppleBillingConfig } from "./appleAppStoreClient.js";
import { requireGoogleBillingConfig } from "./googlePlayClient.js";

/**
 * Every plan a store product can ever resolve to. Deliberately its own type
 * — not `Plan` from @prisma/client — even though it currently has exactly
 * the one value @prisma/client's Plan also allows for billing ("PRO"; FREE
 * is the un-purchased default, never a store product's target). This is
 * the abstraction the Phase 1.1 audit asked for: a future BUSINESS tier
 * only ever needs a second literal added here plus a second catalog entry
 * below — normalizeAppleState/normalizeGoogleState, the webhook handlers,
 * restore, event ordering, and Subscription storage never need to change,
 * because none of them contain a hardcoded "PRO" anymore; they all resolve
 * through resolveApplePlan/resolveGooglePlan.
 */
export type ChakusaBillablePlan = "PRO";

interface CatalogEntry {
  productId: string;
  plan: ChakusaBillablePlan;
}

/**
 * The approved catalog is built from configured product IDs, not a
 * hardcoded literal list — this is what makes "does productId exist" and
 * "does productId map to a plan" the same question today (there is only
 * one configured product) without smuggling in an implicit "any valid
 * product is Pro" assumption: resolveApplePlan/resolveGooglePlan below
 * return `null` for anything not explicitly present, which fails closed
 * for both an unknown product AND a not-yet-configured one.
 */
function appleCatalog(): CatalogEntry[] {
  const apple = requireAppleBillingConfig();
  return [{ productId: apple.proMonthlyProductId, plan: "PRO" }];
}

function googleCatalog(): CatalogEntry[] {
  const google = requireGoogleBillingConfig();
  return [{ productId: google.proMonthlyProductId, plan: "PRO" }];
}

/** Returns the canonical Chakusa plan for an Apple product ID, or null if it isn't in the approved catalog — callers must fail closed on null, never default to PRO. */
export function resolveApplePlan(productId: string): ChakusaBillablePlan | null {
  return appleCatalog().find((entry) => entry.productId === productId)?.plan ?? null;
}

/** Returns the canonical Chakusa plan for a Google product ID, or null if it isn't in the approved catalog — callers must fail closed on null, never default to PRO. */
export function resolveGooglePlan(productId: string): ChakusaBillablePlan | null {
  return googleCatalog().find((entry) => entry.productId === productId)?.plan ?? null;
}
