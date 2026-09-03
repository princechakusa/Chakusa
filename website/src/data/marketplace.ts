// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION. Marketplace feature page.
// Structure adapted from the Stitch export
// (chakusa_marketplace_discover_book_local_services/code.html), with
// one important correction: Stitch presented a live aggregated marketplace
// search page with named businesses, review counts, prices, and a location
// map. The current website does not expose that customer-facing directory.
//
// The real capability confirmed in the product is simpler and stronger:
// each business gets a public profile with services, pricing, hours, and
// public self-booking. This page presents that truthfully and keeps visual
// examples illustrative only.
export const marketplaceHero = {
  badge: "Discover and book, directly",
  title: "Every business gets a public profile customers can book from directly.",
  body: "No marketplace account required to book. A customer sees real services, pricing, and hours, and books straight into the business's own calendar.",
};

export const marketplaceProof = [
  { label: "Every business gets", value: "A public profile" },
  { label: "Booking happens", value: "Directly on the profile" },
  { label: "Customer account", value: "Not required" },
];

export interface MarketplaceCategory {
  icon: string;
  title: string;
  href: string;
}

export const marketplaceCategories: MarketplaceCategory[] = [
  { icon: "cut", title: "Beauty and wellness", href: "/industries/beauty" },
  { icon: "car", title: "Automotive", href: "/industries/automotive" },
  { icon: "briefcase", title: "Professional services", href: "/industries/professional" },
  { icon: "home", title: "Home services", href: "/industries/home-services" },
];

export const profileExample = {
  label: "Illustrative example",
  note: "Not a real business. Shown to demonstrate the public profile format.",
  name: "Example Barber Co.",
  hours: "Open today, 9:00 AM to 6:00 PM",
  services: [
    { name: "Signature Cut and Styling", duration: "45 min", price: "$45" },
    { name: "Full Cut and Beard Trim", duration: "60 min", price: "$70" },
  ],
};

export const marketplaceValues = {
  label: "Why it works this way",
  title: "A profile a business controls, and a customer can trust.",
  points: [
    { icon: "check", title: "Business-set pricing", body: "Services and prices come straight from the business, not a marketplace markup." },
    { icon: "calendar", title: "Real availability", body: "Booking checks the same calendar and rules the business's own team uses." },
    { icon: "user", title: "No account needed", body: "A customer can book without creating a Chakusa account first." },
    { icon: "star", title: "Ungated reviews", body: "Every review comes from a completed visit, never filtered by expected rating." },
  ],
};

export const marketplaceCta = {
  label: "Get your own public profile",
  title: "Ready for customers to find and book you directly?",
  body: "Set up your services, hours, and pricing, and your public profile is ready to share and book from.",
};
