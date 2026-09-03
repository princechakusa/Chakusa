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
