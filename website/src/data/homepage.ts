// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION, STAGE 2.
//
// Reconciled against the approved Stitch header (present, byte-identical
// in structure, across every one of the 14 exported pages except the
// homepage/mobile-app variants): Product | Features (dropdown) |
// How It Works | Marketplace | Pricing, plus a Find Services / Get
// Started CTA pair.
//
// Two deliberate departures from that Stitch structure, both to avoid
// creating a dead link (explicitly forbidden this stage), not oversight:
//
// 1. The Features dropdown in Stitch lists all 9 other feature pages
//    (Bookings, Customers, Retention, Reviews, Automation, AI Assistant,
//    Marketplace, Business Control, Mobile App). None of those routes
//    exist yet: only /features/enquiries does. The dropdown lists only
//    the pages that are real right now; add one entry per feature page
//    as each one ships in a later stage. The shape (label, href,
//    description) already matches Stitch's own copy for Enquiries
//    ("Instant capture and qualification") for continuity once the rest
//    are added.
// 2. Stitch's top-level "Marketplace" link and "Find Services" CTA both
//    point at a live public marketplace/discovery destination that
//    doesn't exist on the website yet (the real marketplace lives inside
//    the mobile app; there is no customer-facing web page for it). Left
//    out of the header for now rather than pointed at nothing. The
//    existing Sign in / Start free CTA pair is kept (real destinations,
//    matches the current site) rather than replaced with Stitch's
//    "Find Services" / "For Business / Get Started" wording, since a
//    literal "Find Services" button needs a real page behind it.
//
// Industries and About are real, working destinations that predate this
// migration and aren't part of the Stitch export at all: kept rather
// than dropped, per Stage 1/2's "preserve valid existing navigation
// destinations" requirement.
export const primaryNavigation = [
  { label: "Product", href: "/product", children: [
    { label: "Customer response", href: "/product#customer-response", description: "Respond to enquiries with human oversight." },
    { label: "Automation", href: "/product#automation", description: "Keep follow-ups and reminders moving." },
    { label: "Bookings", href: "/product#booking", description: "Manage appointments and availability." },
    { label: "Customer growth", href: "/product#business-control", description: "Understand and bring customers back." },
  ] },
  { label: "Features", href: "/features/enquiries", children: [
    { label: "Enquiries", href: "/features/enquiries", description: "Instant capture and qualification." },
    { label: "Bookings", href: "/features/bookings", description: "Customer booking and business availability." },
    { label: "Reviews", href: "/features/reviews", description: "Ungated review requests on every visit." },
    { label: "Customers", href: "/features/customers", description: "One profile per customer, with full history." },
    { label: "Retention", href: "/features/customer-retention", description: "Rebooking reminders for customers who go quiet." },
    { label: "Automation", href: "/features/automation", description: "Task-creating workflows your team reviews." },
    { label: "AI Assistant", href: "/features/ai-assistant", description: "Drafts replies, with your team in the loop." },
    { label: "Marketplace", href: "/features/marketplace", description: "Public profiles customers can book directly." },
    { label: "Business Control", href: "/features/business-control", description: "One dashboard for what needs attention." },
    { label: "Mobile App", href: "/features/mobile-app", description: "One app, two experiences. Coming soon." },
  ] },
  { label: "How it works", href: "/how-it-works" },
  { label: "Industries", href: "/industries", children: [
    { label: "Beauty & wellness", href: "/industries/beauty", description: "Salons, barbers, spas and clinics." },
    { label: "Home services", href: "/industries/home-services", description: "Cleaners, plumbers and electricians." },
    { label: "Automotive", href: "/industries/automotive", description: "Mechanics, detailers and car washes." },
    { label: "Professional services", href: "/industries/professional", description: "Dentists, photographers and consultants." },
  ] },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
];

// Footer reconciled the same way: Stitch's footer additionally lists
// Enterprise Solutions, Partner Program, Security & Compliance, Trust
// Center, and Help Center: none of which are real products, plans, or
// pages yet. The fabricated "Chakusa Technologies Inc." copyright
// line, replaced by FooterLegal.astro's real one. Only real destinations
// appear below.
export const footerGroups = [
  { title: "Product", links: [{ label: "How it works", href: "/how-it-works" }, { label: "Customer response", href: "/product#customer-response" }, { label: "Automation", href: "/product#automation" }, { label: "Bookings", href: "/product#booking" }, { label: "Pricing", href: "/pricing" }] },
  { title: "Features", links: [{ label: "Enquiries & leads", href: "/features/enquiries" }, { label: "Bookings", href: "/features/bookings" }, { label: "Reviews", href: "/features/reviews" }, { label: "Customers", href: "/features/customers" }, { label: "Retention", href: "/features/customer-retention" }, { label: "Automation", href: "/features/automation" }, { label: "AI assistant", href: "/features/ai-assistant" }, { label: "Marketplace", href: "/features/marketplace" }, { label: "Business control", href: "/features/business-control" }, { label: "Mobile app", href: "/features/mobile-app" }, { label: "Industries", href: "/industries" }] },
  { title: "Company", links: [{ label: "About", href: "/about" }, { label: "Sign in", href: "/login" }, { label: "Get started", href: "/get-started" }] },
  { title: "Legal", links: [{ label: "Privacy", href: "/privacy" }, { label: "Terms", href: "/terms" }, { label: "Cookies", href: "/cookies" }, { label: "AI disclosure", href: "/ai-disclosure" }] },
];
