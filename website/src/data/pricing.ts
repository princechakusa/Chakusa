// MARKETING PRICING PRESENTATION - deliberately separate from live
// billing implementation (no billing/entitlement enforcement is being
// built or changed by this file). There is no permanent free plan:
// all three tiers are presented as a 14-day free trial followed by a
// paid subscription (Starter at a fixed $9.99/month; Pro and Business
// at a store-billed, localized price). This is a marketing-copy
// change only - it does NOT reflect src/lib/entitlements.ts's current
// PLAN_LIMITS (still "free" there) and does NOT imply the
// billing/trial/entitlement architecture has been built; that is
// separate, later work. Feature limits below are otherwise unchanged
// and still mirror entitlements.ts pending that later work.
export interface PricingTier {
  name: string;
  // Stitch's exact per-card secondary chip badge ("Solo Pro," "High
  // Capacity," "Multi-Location"), sitting beside the tier name.
  chip: string;
  tagline: string;
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
    name: "Starter",
    chip: "Solo Pro",
    tagline: "For independent barbers, mobile detailers, freelance photographers, and solo trade technicians.",
    price: "$9.99",
    priceNote: "per month, after a 14-day free trial. Cancel anytime.",
    includedLabel: "Included operational tools",
    features: [
      "Up to 40 leads a month",
      "Up to 40 review requests a month",
      "Up to 200 customers",
      "Up to 40 open reminders",
      "1 custom message template per type",
      "1 team seat",
    ],
    ctaLabel: "Get started with Starter",
    ctaHref: "/get-started",
    ctaFootnote: "First 14 days free",
  },
  {
    name: "Pro",
    chip: "High Capacity",
    tagline: "For multi-chair salons, automotive service centers, wellness studios, and small dispatched crews.",
    price: "See store price",
    priceNote: "First 14 days free, then billed through the App Store or Google Play. The store's localized price is the purchase authority. Cancel anytime.",
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
    ctaFootnote: "First 14 days free",
    featured: true,
  },
  {
    name: "Business",
    chip: "Multi-Location",
    tagline: "For trade franchises, multi-location studio operations, and teams with more than one person answering the phone.",
    price: "See store price",
    priceNote: "First 14 days free, then billed through the App Store or Google Play. The store's localized price is the purchase authority. Cancel anytime.",
    includedLabel: "Everything in Pro, plus",
    features: [
      "Everything in Pro",
      "Up to 10 team members with roles and invitations",
    ],
    ctaLabel: "Choose Business",
    ctaHref: "/get-started",
    ctaFootnote: "First 14 days free",
  },
];
