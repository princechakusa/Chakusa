// PROGRAM: POWERFUL FEATURES PROGRAM. The first standalone feature page
// (see src/pages/features/enquiries.astro). Kept as its own top-level nav
// entry, distinct from "Product". Plain link, not a dropdown: with only
// one feature page live, a dropdown whose single child pointed at the
// same URL as the parent label was genuinely confusing (clicking either
// looked identical, and clicking the child a second time did nothing
// since the browser was already there). Revisit as a dropdown once a
// second feature page exists (see that page's final report for
// recommended routes) and there's an actual choice to present.
export const primaryNavigation = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Features", href: "/features/enquiries" },
  { label: "Product", href: "/product", children: [
    { label: "Customer response", href: "/product#customer-response", description: "Respond to enquiries with human oversight." },
    { label: "Automation", href: "/product#automation", description: "Keep follow-ups and reminders moving." },
    { label: "Bookings", href: "/product#booking", description: "Manage appointments and availability." },
    { label: "Customer growth", href: "/product#business-control", description: "Understand and bring customers back." },
  ] },
  { label: "Industries", href: "/industries", children: [
    { label: "Beauty & wellness", href: "/industries/beauty", description: "Salons, barbers, spas and clinics." },
    { label: "Home services", href: "/industries/home-services", description: "Cleaners, plumbers and electricians." },
    { label: "Automotive", href: "/industries/automotive", description: "Mechanics, detailers and car washes." },
    { label: "Professional services", href: "/industries/professional", description: "Dentists, photographers and consultants." },
  ] },
  { label: "Pricing", href: "/pricing" },
  { label: "About", href: "/about" },
];

export const footerGroups = [
  { title: "Product", links: [{ label: "How it works", href: "/how-it-works" }, { label: "Customer response", href: "/product#customer-response" }, { label: "Automation", href: "/product#automation" }, { label: "Bookings", href: "/product#booking" }, { label: "Pricing", href: "/pricing" }] },
  { title: "Solutions", links: [{ label: "Recover missed leads", href: "/features/enquiries" }, { label: "Customer follow-up", href: "/product#reviews" }, { label: "Reviews", href: "/product#reviews" }, { label: "Industries", href: "/industries" }] },
  { title: "Company", links: [{ label: "About", href: "/about" }, { label: "Sign in", href: "/login" }, { label: "Get started", href: "/get-started" }] },
  { title: "Legal", links: [{ label: "Privacy", href: "/privacy" }, { label: "Terms", href: "/terms" }, { label: "Cookies", href: "/cookies" }, { label: "AI disclosure", href: "/ai-disclosure" }] },
];
