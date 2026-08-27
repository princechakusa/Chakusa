// Mirrors src/lib/entitlements.ts's PLAN_LIMITS / PLAN_FEATURES exactly.
// Re-verify these numbers against that file before every release, see
// docs/WEBSITE_IMPLEMENTATION_HANDBOOK.md Part 2's Pricing acceptance
// criteria. Store-localized subscription prices remain authoritative and
// deliberately are not duplicated in website source.

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
    name: "Free",
    tagline: "Everything you need to start recovering customers.",
    price: "$0",
    priceNote: "No card required",
    features: [
      "Up to 40 leads a month",
      "Up to 40 review requests a month",
      "Up to 200 customers",
      "Up to 40 open reminders",
      "1 custom message template per type",
      "1 team seat",
    ],
    ctaLabel: "Start free",
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
