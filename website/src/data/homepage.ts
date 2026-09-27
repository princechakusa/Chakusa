// Complete public website navigation. Product, Features, and Industries
// are rendered by the shared mega-panel family (see data/megaMenu.ts and
// DesktopNavigation.astro / MobileNavigation.astro) — those three entries
// carry no `children` here because they're never reached through the
// generic fallback branch those components use for plain dropdowns.
export const primaryNavigation = [
  { label: "Product", href: "/product" },
  { label: "Features", href: "/features/enquiries" },
  { label: "How it works", href: "/how-it-works" },
  { label: "Industries", href: "/industries" },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
];

// Shared footer for the complete public website. Legal and trust links
// live once, in the bottom row (FooterLegal.astro), not repeated here.
export const footerGroups = [
  { title: "Navigation", links: [{ label: "About Us", href: "/about" }, { label: "Contact Support", href: "/contact" }, { label: "Help Center", href: "/help" }, { label: "How it works", href: "/how-it-works" }, { label: "Pricing", href: "/pricing" }, { label: "Sign in", href: "/login" }, { label: "Get started", href: "/get-started" }] },
  { title: "Solutions", links: [{ label: "Enquiries & leads", href: "/features/enquiries" }, { label: "Bookings", href: "/features/bookings" }, { label: "Reviews", href: "/features/reviews" }, { label: "Customers", href: "/features/customers" }, { label: "Retention", href: "/features/customer-retention" }, { label: "Automation", href: "/features/automation" }, { label: "AI assistant", href: "/features/ai-assistant" }, { label: "Marketplace", href: "/features/marketplace" }, { label: "Business control", href: "/features/business-control" }, { label: "Mobile app", href: "/features/mobile-app" }, { label: "Industries", href: "/industries" }] },
];
