// Complete public website navigation. Features, Product, and Industries
// are rendered by the shared premium mega-menu family in DesktopNavigation.
// Every link below resolves to a public route in the current build.
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
    { label: "Mobile App", href: "/features/mobile-app", description: "One app, two connected experiences." },
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

// Shared footer for the complete public website. The Trust & Compliance
// column connects the four approved legal destinations, and its heading
// links to the /trust hub page.
export const footerGroups = [
  { title: "Navigation", links: [{ label: "About Us", href: "/about" }, { label: "Contact Support", href: "/contact" }, { label: "Help Center", href: "/help" }, { label: "How it works", href: "/how-it-works" }, { label: "Pricing", href: "/pricing" }, { label: "Sign in", href: "/login" }, { label: "Get started", href: "/get-started" }] },
  { title: "Solutions", links: [{ label: "Enquiries & leads", href: "/features/enquiries" }, { label: "Bookings", href: "/features/bookings" }, { label: "Reviews", href: "/features/reviews" }, { label: "Customers", href: "/features/customers" }, { label: "Retention", href: "/features/customer-retention" }, { label: "Automation", href: "/features/automation" }, { label: "AI assistant", href: "/features/ai-assistant" }, { label: "Marketplace", href: "/features/marketplace" }, { label: "Business control", href: "/features/business-control" }, { label: "Mobile app", href: "/features/mobile-app" }, { label: "Industries", href: "/industries" }] },
  { title: "Trust & Compliance", href: "/trust", links: [{ label: "Privacy Policy", href: "/privacy" }, { label: "Terms of Service", href: "/terms" }, { label: "AI Disclosure", href: "/ai-disclosure" }, { label: "Cookie Policy", href: "/cookies" }] },
];
