export const primaryNavigation = [
  { label: "Product", href: "/product", children: [
    { label: "AI Receptionist", href: "/product#ai-receptionist", description: "Respond to enquiries with human oversight." },
    { label: "Automation", href: "/product#automation", description: "Keep follow-ups and reminders moving." },
    { label: "Bookings", href: "/product#bookings", description: "Manage appointments and availability." },
    { label: "Customer growth", href: "/product#customers", description: "Understand and bring customers back." },
  ] },
  { label: "Solutions", href: "/product" },
  { label: "Industries", href: "/industries", children: [
    { label: "Beauty & wellness", href: "/industries/beauty", description: "Salons, barbers, spas and clinics." },
    { label: "Home services", href: "/industries/home-services", description: "Cleaners, plumbers and electricians." },
    { label: "Automotive", href: "/industries/automotive", description: "Mechanics, detailers and car washes." },
    { label: "Professional services", href: "/industries/professional", description: "Dentists, photographers and consultants." },
  ] },
  { label: "Pricing", href: "/pricing" },
  { label: "Resources", href: "/about" },
];

export const footerGroups = [
  { title: "Product", links: [{ label: "AI Receptionist", href: "/product#ai-receptionist" }, { label: "Automation", href: "/product#automation" }, { label: "Bookings", href: "/product#bookings" }, { label: "Pricing", href: "/pricing" }] },
  { title: "Solutions", links: [{ label: "Recover opportunities", href: "/product#recover" }, { label: "Customer follow-up", href: "/product#retain" }, { label: "Reviews", href: "/product#review" }, { label: "Industries", href: "/industries" }] },
  { title: "Company", links: [{ label: "About", href: "/about" }, { label: "Sign in", href: "/login" }, { label: "Get started", href: "/get-started" }] },
  { title: "Legal", links: [{ label: "Privacy", href: "/privacy" }, { label: "Terms", href: "/terms" }, { label: "Cookies", href: "/cookies" }, { label: "AI disclosure", href: "/ai-disclosure" }] },
];
