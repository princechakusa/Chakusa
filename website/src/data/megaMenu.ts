// Features mega menu, matching Stitch's "Option B: Product Discovery
// Mega Menu (Architectural Quadrants)" — the explicitly marked
// "ARCHITECTURAL WINNER" in the newest enhanced Stitch export
// (modern_local_commerce_system, section 01). Structure and layout
// (4 quadrants + a dedicated right-hand promo panel) reproduced
// exactly; the specific tag chips and promo copy are grounded in real
// shipped feature pages, not Stitch's fabricated specifics ("Zero
// collisions," "Sub-5mi Radius," a "Twin Engine" architectural
// whitepaper that doesn't exist).
export interface MegaMenuLink { label: string; href: string }
export interface MegaMenuQuadrant { icon: string; title: string; body: string; tags: string[]; links: MegaMenuLink[] }

export const megaMenuQuadrants: MegaMenuQuadrant[] = [
  {
    icon: "inbox",
    title: "Customer growth",
    body: "Capture and act on every new customer moment.",
    tags: ["Live enquiries", "Public discovery"],
    links: [
      { label: "Enquiries & leads", href: "/features/enquiries" },
      { label: "Marketplace", href: "/features/marketplace" },
    ],
  },
  {
    icon: "calendar",
    title: "Operations",
    body: "One calendar and one dashboard for the working day.",
    tags: ["Booking core", "Attention center"],
    links: [
      { label: "Bookings", href: "/features/bookings" },
      { label: "Business control", href: "/features/business-control" },
    ],
  },
  {
    icon: "users",
    title: "Customer relationships",
    body: "Every customer, review, and comeback tracked in one place.",
    tags: ["Client records", "Ungated reviews"],
    links: [
      { label: "Customers", href: "/features/customers" },
      { label: "Retention", href: "/features/retention" },
      { label: "Reviews", href: "/features/reviews" },
    ],
  },
  {
    icon: "sparkle",
    title: "Automation & AI",
    body: "Task-based workflows and an assistant your team reviews.",
    tags: ["Draft mode by default", "Never sends automatically"],
    links: [
      { label: "Automation", href: "/features/automation" },
      { label: "AI assistant", href: "/features/ai-assistant" },
      { label: "Mobile app", href: "/features/mobile-app" },
    ],
  },
];

export const megaMenuPromo = {
  badge: "One app, two modes",
  title: "The same app, for customers and businesses.",
  body: "No second login, no separate app. A customer discovers and books; a business runs its day, in the same Chakusa app.",
  linkLabel: "See how it works",
  linkHref: "/how-it-works",
};
