// MARKETING PRICING PRESENTATION. Prices and trial lengths are NOT written
// here: they come from the admin console's App configuration (see
// pricingDefaults.ts). What each plan includes mirrors the API's entitlement
// tables (src/lib/entitlements.ts) and is refreshed from GET /plans in the
// browser; the lists below are the fallback until that loads.
import { formatPlanPrice, PRICING_FALLBACK, type PlanKey } from "./pricingDefaults";

export interface PricingTier {
  plan: PlanKey;
  name: string;
  // Stitch's exact per-card secondary chip badge ("Solo Pro," "High
  // Capacity," "Multi-Location"), sitting beside the tier name.
  chip: string;
  tagline: string;
  /** Fallback only; the live price is applied by siteConfig.ts. */
  price: string;
  priceNote?: string;
  // Stitch's "EVERYTHING IN [PRIOR TIER], PLUS" / "INCLUDED OPERATIONAL
  // TOOLS" label directly above the feature list.
  includedLabel: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  ctaFootnote: string;
  featured?: boolean;
}

export const pricingTiers: PricingTier[] = [
  {
    plan: "STARTER",
    name: "Starter",
    chip: "Solo Pro",
    tagline: "For independent barbers, mobile detailers, freelance photographers, and solo trade technicians.",
    price: formatPlanPrice(PRICING_FALLBACK.monthly.STARTER, PRICING_FALLBACK.currency),
    priceNote: "per month. Cancel anytime.",
    includedLabel: "Included operational tools",
    features: [
      "Up to 150 leads a month",
      "Up to 150 review requests a month",
      "Up to 1,000 customers",
      "Up to 150 open reminders",
      "3 custom message templates per type",
      "Extended activity history",
      "1 team seat",
    ],
    ctaLabel: "Get started with Starter",
    ctaHref: "/get-started",
    ctaFootnote: "Free trial included",
  },
  {
    plan: "PRO",
    name: "Pro",
    chip: "High Capacity",
    tagline: "For multi-chair salons, automotive service centers, wellness studios, and small dispatched crews.",
    price: formatPlanPrice(PRICING_FALLBACK.monthly.PRO, PRICING_FALLBACK.currency),
    priceNote: "per month, billed through the App Store or Google Play in your local currency. Cancel anytime.",
    includedLabel: "Everything in Starter, plus",
    features: [
      "Unlimited leads, review requests, customers, and reminders",
      "Unlimited custom message templates",
      "Missed-call follow-up automation (rolling out)",
      "Send messages directly through Chakusa",
      "Advanced analytics and extended history",
    ],
    ctaLabel: "Choose Pro",
    ctaHref: "/get-started",
    ctaFootnote: "Billed by your app store",
    featured: true,
  },
  {
    plan: "BUSINESS",
    name: "Business",
    chip: "Multi-Location",
    tagline: "For trade franchises, multi-location studio operations, and teams with more than one person answering the phone.",
    price: formatPlanPrice(PRICING_FALLBACK.monthly.BUSINESS, PRICING_FALLBACK.currency),
    priceNote: "per month, billed through the App Store or Google Play in your local currency. Cancel anytime.",
    includedLabel: "Everything in Pro, plus",
    features: [
      "Everything in Pro",
      "Up to 10 team members with roles and invitations",
    ],
    ctaLabel: "Choose Business",
    ctaHref: "/get-started",
    ctaFootnote: "Billed by your app store",
  },
];
