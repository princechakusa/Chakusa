import { requireAppleBillingConfig } from "./appleAppStoreClient.js";
import { requireGoogleBillingConfig } from "./googlePlayClient.js";

/**
 * Every plan a store product can ever resolve to. Deliberately its own type
 * — not `Plan` from @prisma/client — even though every value here is also a
 * `Plan` value (FREE is the un-purchased default, never a store product's
 * target, so it's excluded here). This is the abstraction the Phase 1.1
 * audit asked for and Business Phase 1 exercises for the first time: adding
 * BUSINESS required exactly one literal added here plus one catalog entry
 * per provider below — normalizeAppleState/normalizeGoogleState, the
 * webhook handlers, restore, event ordering, and Subscription storage
 * needed zero changes, because none of them contain a hardcoded plan
 * literal; they all resolve through resolveApplePlan/resolveGooglePlan.
 */
export type ChakusaBillablePlan = "PRO" | "BUSINESS";

interface CatalogEntry {
  productId: string;
  plan: ChakusaBillablePlan;
}

/**
 * The approved catalog is built from configured product IDs, not a
 * hardcoded literal list — this is what makes "does productId exist" and
 * "does productId map to a plan" the same question without smuggling in an
 * implicit "any valid product is Pro/Business" assumption:
 * resolveApplePlan/resolveGooglePlan below return `null` for anything not
 * explicitly present, which fails closed for both an unknown product AND a
 * not-yet-configured one (e.g. Business's product ID, unset until real
 * store configuration exists — see config.ts's
 * APPLE_BUSINESS_MONTHLY_PRODUCT_ID / GOOGLE_BUSINESS_MONTHLY_PRODUCT_ID).
 */
function appleCatalog(): CatalogEntry[] {
  const apple = requireAppleBillingConfig();
  const entries: CatalogEntry[] = [{ productId: apple.proMonthlyProductId, plan: "PRO" }];
  if (apple.businessMonthlyProductId) entries.push({ productId: apple.businessMonthlyProductId, plan: "BUSINESS" });
  return entries;
}

function googleCatalog(): CatalogEntry[] {
  const google = requireGoogleBillingConfig();
  const entries: CatalogEntry[] = [{ productId: google.proMonthlyProductId, plan: "PRO" }];
  if (google.businessMonthlyProductId) entries.push({ productId: google.businessMonthlyProductId, plan: "BUSINESS" });
  return entries;
}

/** Returns the canonical Chakusa plan for an Apple product ID, or null if it isn't in the approved catalog — callers must fail closed on null, never default to any plan. */
export function resolveApplePlan(productId: string): ChakusaBillablePlan | null {
  return appleCatalog().find((entry) => entry.productId === productId)?.plan ?? null;
}

/** Returns the canonical Chakusa plan for a Google product ID, or null if it isn't in the approved catalog — callers must fail closed on null, never default to any plan. */
export function resolveGooglePlan(productId: string): ChakusaBillablePlan | null {
  return googleCatalog().find((entry) => entry.productId === productId)?.plan ?? null;
}
