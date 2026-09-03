// Features mega menu, adapted from Stitch's Product Discovery Mega Menu.
// The structure keeps the four product quadrants and one supporting panel,
// while the copy points only to real Chakusa routes and real capabilities.
export interface MegaMenuLink {
  label: string;
  href: string;
}

export interface MegaMenuQuadrant {
  icon: string;
  title: string;
  body: string;
  tags: string[];
  links: MegaMenuLink[];
}

export const megaMenuQuadrants: MegaMenuQuadrant[] = [
  {
    icon: "inbox",
    title: "Customer growth",
    body: "Capture and act on every new customer moment.",
    tags: ["Live enquiries", "Public profiles"],
    links: [
      { label: "Enquiries and leads", href: "/features/enquiries" },
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
      { label: "Customer retention", href: "/features/customer-retention" },
      { label: "Reviews", href: "/features/reviews" },
    ],
  },
  {
    icon: "sparkle",
    title: "Automation and AI",
    body: "Task-based workflows and an assistant your team reviews.",
    tags: ["Human review", "Draft support"],
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
  body: "A customer discovers and books. A business runs the day in the same Chakusa app.",
  linkLabel: "See how it works",
  linkHref: "/how-it-works",
};

// Product mega menu - same visual system as Features (SimpleMegaMenu
// reuses the identical .mega-menu markup/CSS), real product-capability
// destinations, no dead links.
export const productMegaLinks = [
  { label: "Product overview", href: "/product", icon: "storefront", group: "Overview" },
  { label: "Enquiries", href: "/features/enquiries", icon: "inbox", group: "Customer growth" },
  { label: "Bookings", href: "/features/bookings", icon: "calendar", group: "Operations" },
  { label: "Customers", href: "/features/customers", icon: "users", group: "Relationships" },
  { label: "Reviews", href: "/features/reviews", icon: "star", group: "Relationships" },
  { label: "Retention", href: "/features/customer-retention", icon: "repeat", group: "Relationships" },
  { label: "Automation", href: "/features/automation", icon: "sparkle", group: "Automation & AI" },
  { label: "AI assistant", href: "/features/ai-assistant", icon: "chat", group: "Automation & AI" },
  { label: "Business control", href: "/features/business-control", icon: "shield", group: "Operations" },
  { label: "Mobile app", href: "/features/mobile-app", icon: "smartphone", group: "Automation & AI" },
];

// Industries mega menu - the 4 real, working industry category pages
// (src/data/industries.ts). Per the directive: present industries as
// product-use categories without creating dead links for specific
// trades that don't have their own dedicated URL.
export const industriesMegaLinks = [
  { label: "Beauty & wellness", href: "/industries/beauty", icon: "spa", group: "Salons, barbers, spas & clinics" },
  { label: "Home services", href: "/industries/home-services", icon: "clean", group: "Cleaners, plumbers & electricians" },
  { label: "Automotive", href: "/industries/automotive", icon: "car", group: "Mechanics, detailers & car washes" },
  { label: "Professional services", href: "/industries/professional", icon: "camera", group: "Dentists, photographers & consultants" },
];
