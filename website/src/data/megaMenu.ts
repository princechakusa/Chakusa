// Navigation mega-menu content: Features, Product, and Industries.
// Each menu is column-grouped (real spacing between groups, not a flat
// list) with automation/AI split into its own visually distinct panel —
// it's a different kind of capability (assisted, human-reviewed) and
// reads that way, not just another row next to Bookings.
export interface MegaMenuLink {
  label: string;
  href: string;
  icon: string;
  description: string;
}

export interface MegaMenuGroup {
  title: string;
  links: MegaMenuLink[];
}

// Features menu: three real columns. The last is the AI/automation panel,
// rendered with its own dark treatment in MegaMenu.astro.
export const featuresMegaGroups: MegaMenuGroup[] = [
  {
    title: "Customer growth",
    links: [
      { label: "Enquiries & leads", href: "/features/enquiries", icon: "inbox", description: "Every enquiry saved as a lead, nothing dropped." },
      { label: "Marketplace", href: "/features/marketplace", icon: "storefront", description: "Public profiles customers can book directly." },
      { label: "Reviews", href: "/features/reviews", icon: "star", description: "Ungated review requests on every visit." },
    ],
  },
  {
    title: "Operations",
    links: [
      { label: "Bookings", href: "/features/bookings", icon: "calendar", description: "Customer booking and business availability." },
      { label: "Customers", href: "/features/customers", icon: "users", description: "One profile per customer, with full history." },
      { label: "Retention", href: "/features/customer-retention", icon: "repeat", description: "Rebooking reminders for customers who go quiet." },
      { label: "Business control", href: "/features/business-control", icon: "shield", description: "One dashboard for what needs attention." },
    ],
  },
];

export const featuresAiGroup: MegaMenuGroup = {
  title: "Automation & AI",
  links: [
    { label: "AI assistant", href: "/features/ai-assistant", icon: "chat", description: "Drafts replies from your own info." },
    { label: "Automation", href: "/features/automation", icon: "sparkle", description: "Task-creating workflows your team reviews." },
    { label: "Mobile app", href: "/features/mobile-app", icon: "smartphone", description: "One connected app for the whole team." },
  ],
};

export const featuresMegaPromo = {
  eyebrow: "Assisted, not automatic",
  title: "A team stays in charge of every send.",
  body: "AI can draft a reply or flag a task. Eligible automation is owner-reviewed, and a person can take over any conversation at any point.",
  linkLabel: "See the AI assistant",
  linkHref: "/features/ai-assistant",
};

// Product menu: same column/AI-panel treatment, pointed at the product
// story pages instead of individual feature pages.
export const productMegaGroups: MegaMenuGroup[] = [
  {
    title: "Customer growth",
    links: [
      { label: "Enquiries", href: "/features/enquiries", icon: "inbox", description: "Capture and act on every new lead." },
      { label: "Marketplace", href: "/features/marketplace", icon: "storefront", description: "Public profiles built to convert." },
    ],
  },
  {
    title: "Operations & relationships",
    links: [
      { label: "Bookings", href: "/features/bookings", icon: "calendar", description: "One calendar for the working day." },
      { label: "Customers", href: "/features/customers", icon: "users", description: "Every customer, one record." },
      { label: "Reviews", href: "/features/reviews", icon: "star", description: "Honest, never sentiment-gated." },
      { label: "Business control", href: "/features/business-control", icon: "shield", description: "One dashboard, not five tools." },
    ],
  },
];

export const productAiGroup: MegaMenuGroup = {
  title: "Automation & AI",
  links: [
    { label: "AI assistant", href: "/features/ai-assistant", icon: "chat", description: "Drafts replies, your team sends them." },
    { label: "Automation", href: "/features/automation", icon: "sparkle", description: "Workflows your team reviews first." },
    { label: "Mobile app", href: "/features/mobile-app", icon: "smartphone", description: "The whole platform, in your pocket." },
  ],
};

export const productMegaPromo = {
  eyebrow: "One app, two modes",
  title: "The same app, for customers and businesses.",
  body: "A customer discovers and books. A business runs the day in the same Chakusa app.",
  linkLabel: "See how it works",
  linkHref: "/how-it-works",
};

// Industries mega menu — the 4 real, working industry category pages
// (src/data/industries.ts). Per the directive: present industries as
// product-use categories without creating dead links for specific
// trades that don't have their own dedicated URL.
export const industriesMegaLinks = [
  { label: "Beauty & wellness", href: "/industries/beauty", icon: "spa", group: "Salons, barbers, spas & clinics" },
  { label: "Home services", href: "/industries/home-services", icon: "clean", group: "Cleaners, plumbers & electricians" },
  { label: "Automotive", href: "/industries/automotive", icon: "car", group: "Mechanics, detailers & car washes" },
  { label: "Professional services", href: "/industries/professional", icon: "camera", group: "Dentists, photographers & consultants" },
];
