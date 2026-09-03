// MARKETING PRICING PRESENTATION - deliberately separate from live
// billing implementation (no billing/entitlement enforcement is being
// built or changed by this file; see "FINAL STITCH FIDELITY DIRECTIVE",
// sections 7-9). The entry tier is now presented as "Starter" at
// $9.99/month with a 14-day free trial, an explicit owner-approved
// business decision superseding the earlier permanent-free "Free" tier
// shown on this page. This is a marketing-copy change only - it does
// NOT reflect src/lib/entitlements.ts's current PLAN_LIMITS (still
// "free" there) and does NOT imply the billing/trial/entitlement
// architecture has been built; that is separate, later work per the
// directive's section 8. Feature limits below are otherwise unchanged
// and still mirror entitlements.ts pending that later work.
export interface PricingTier {
  name: string;
  tagline: string;
  price: string;
  priceNote?: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  featured?: boolean;
}

export const pricingTiers: PricingTier[] = [
  {
    name: "Starter",
    tagline: "Everything you need to start bringing customers back.",
    price: "$9.99",
    priceNote: "per month, after a 14-day free trial. Cancel anytime.",
    features: [
      "Up to 40 leads a month",
      "Up to 40 review requests a month",
      "Up to 200 customers",
      "Up to 40 open reminders",
      "1 custom message template per type",
      "1 team seat",
    ],
    ctaLabel: "Start 14-day free trial",
    ctaHref: "/get-started",
  },
  {
    name: "Pro",
    tagline: "For businesses ready to stop tracking this by hand.",
    price: "See store price",
    priceNote: "Billed through the App Store or Google Play. The store's localized price is the purchase authority.",
    features: [
      "Unlimited leads, review requests, customers, and reminders",
      "Unlimited custom message templates",
      "Missed-call follow-up automation (rolling out)",
      "Send messages directly through Chakusa",
      "Advanced analytics and extended history",
    ],
    ctaLabel: "Start free",
    ctaHref: "/get-started",
    featured: true,
  },
  {
    name: "Business",
    tagline: "For teams with more than one person answering the phone.",
    price: "See store price",
    priceNote: "Billed through the App Store or Google Play. The store's localized price is the purchase authority.",
    features: [
      "Everything in Pro",
      "Up to 10 team members with roles and invitations",
    ],
    ctaLabel: "Start free",
    ctaHref: "/get-started",
  },
];
