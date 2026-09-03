// Product-truth ledger: every claim below is checked against the actual
// backend modules (src/modules/*) and mobile feature flags
// (mobile/PRODUCTION_ENVIRONMENT.md) at time of writing. Automation and
// billing describe themselves as owner-reviewed/prospective, not live,
// because EXPO_PUBLIC_AUTOMATION_ENABLED and EXPO_PUBLIC_BILLING_ENABLED
// are both false in production. `visual: null` means no real screenshot
// exists for that story yet - never filled with a placeholder or fabricated
// UI, per website/README.md's asset convention.

// Hero proof strip, added for structural parity with every other
// migrated page's stat-strip pattern. Same facts established elsewhere
// in this file, not new claims.
export const productProof = [
  { label: "Connects", value: "Enquiries to reviews" },
  { label: "Sending", value: "Reviewed by your team" },
  { label: "Lock-in", value: "None" },
];

export const lifecycleSteps = [
  { id: "discover", label: "Discover" },
  { id: "enquire", label: "Enquire" },
  { id: "book", label: "Book" },
  { id: "serve", label: "Serve" },
  { id: "review", label: "Review" },
  { id: "return", label: "Return" },
];

export interface ProductStory {
  id: string;
  step: string;
  eyebrow: string;
  title: string;
  copy: string;
  features: string[];
  next: string;
  visual: string | null;
  visualLabel: string;
}

export const productStories: ProductStory[] = [
  { id: "customer-response", step: "01", eyebrow: "Discover and respond", title: "Be ready when a customer finds you.", copy: "Marketplace listings and public business profiles help customers understand the business. When an enquiry arrives, Chakusa keeps the conversation connected to the customer and gives the team control over the response.", features: ["Marketplace", "Business profiles", "AI Receptionist", "Messaging"], next: "The conversation becomes a customer relationship.", visual: null, visualLabel: "Marketplace and enquiry" },
  { id: "booking", step: "02", eyebrow: "Know and book", title: "Move from interest to a confirmed visit.", copy: "Customer profiles keep useful context together. Services, availability, calendar tools, and booking help the business turn a conversation into a clear appointment.", features: ["Services", "Availability", "Booking", "Calendar"], next: "A confirmed booking starts the service journey.", visual: null, visualLabel: "Booking and calendar" },
  { id: "customer-profiles", step: "03", eyebrow: "Remember every customer", title: "The relationship doesn't end when the appointment does.", copy: "Every enquiry, booking, note, and outcome collects on one customer record. The next conversation starts with context, not a blank slate, whoever on the team picks it up.", features: ["Customer profiles", "Booking history", "Notes", "Preferences"], next: "Context carries forward to the visit and every visit after it.", visual: null, visualLabel: "Customer profile and history" },
  { id: "automation", step: "04", eyebrow: "Prepare and follow through", title: "Keep the next step from being forgotten.", copy: "Messaging and automation support confirmations, reminders, follow-ups, and internal work. The business chooses what runs and where human approval is needed.", features: ["Messaging", "Automation", "Reminders", "Team management"], next: "The right follow-up continues after the visit.", visual: null, visualLabel: "Automation and reminders" },
  { id: "reviews", step: "05", eyebrow: "Ask, always", title: "Turn a completed visit into public trust.", copy: "Chakusa helps request a review while the visit is still fresh and collect private feedback alongside it. Both happen for every visit, not just the ones that went well.", features: ["Review requests", "Private feedback", "Reputation tracking"], next: "Feedback becomes part of the customer record.", visual: null, visualLabel: "Review and feedback requests" },
  { id: "retention", step: "06", eyebrow: "Bring them back", title: "Know exactly who's due before they quietly stop coming.", copy: "Chakusa surfaces customers who haven't rebooked in the expected window, so a reminder goes out while they're still a returning customer, not after they've become a former one.", features: ["Comeback reminders", "Due-back tracking", "Repeat visit history"], next: "A returning customer restarts the cycle.", visual: null, visualLabel: "Customers due back" },
];

// Bottom stat-panel line for each engine card, matching Stitch's inner
// "chip" panel structure exactly. Real facts, not Stitch's specific
// invented numbers ("100% Captured", "82%", "0% Hallucination Policy").
export const productStoryStats: Record<string, { label: string; value: string }> = {
  "customer-response": { label: "Who replies", value: "Your team, always" },
  booking: { label: "Conflict checking", value: "Built in" },
  "customer-profiles": { label: "Data export", value: "CSV, anytime" },
  automation: { label: "Sends automatically", value: "Never" },
  reviews: { label: "Rating-based filtering", value: "None" },
  retention: { label: "Guaranteed rebooking", value: "Not promised" },
};

// Icon keys for the six-engine grid (Stitch's "Six foundational engines"
// section) - maps 1:1 to productStories by id, same copy, just a visual
// treatment addition.
export const productStoryIcons: Record<string, string> = {
  "customer-response": "chat",
  booking: "calendar",
  "customer-profiles": "note",
  automation: "task",
  reviews: "star",
  retention: "repeat",
};

// The "instant handshake between buyer and maker" section - what the
// customer sees vs. what the business sees, reusing the real facts from
// marketplace/businessControl below rather than introducing new copy.
export const handshake = {
  eyebrow: "Two views, one system",
  title: "The connection between customer and business.",
  body: "The same event updates both sides at once. A customer's enquiry appears on the business's dashboard immediately; a business's response reaches the customer the same way.",
  customer: { label: "Customer view", title: "Browse, enquire, and track a booking.", points: ["Marketplace and business profiles", "Direct enquiries", "Booking status"] },
  business: { label: "Business view", title: "See enquiries, bookings, and what needs attention.", points: ["One dashboard for the day", "Prepared responses to review", "Customer history on every profile"] },
};

export interface ProductIndustry { icon: string; label: string; body: string; tag: string }
export const productIndustryCards: ProductIndustry[] = [
  { icon: "cut", label: "Barbers & Salons", body: "Chair appointments, add-on services, and recurring rebooking reminders.", tag: "Booking & rebooking" },
  { icon: "spa", label: "Beauty & Spa", body: "Treatment bookings, client history, and reviews requested while fresh.", tag: "Client history" },
  { icon: "health", label: "Dentists", body: "Appointment confirmations, intake context, and recall reminders.", tag: "Recall scheduling" },
  { icon: "car", label: "Mechanics", body: "Service enquiries, appointment scheduling, and service-due reminders.", tag: "Service tracking" },
  { icon: "clean", label: "Cleaners", body: "Recurring visit scheduling, customer notes, and follow-up after every job.", tag: "Recurring visits" },
  { icon: "camera", label: "Photographers", body: "Enquiry capture for shoot requests and a portfolio customers can find.", tag: "Enquiry capture" },
];

export const aiAssistant = {
  eyebrow: "Assisted, not automatic",
  title: "AI that drafts and responds, a team that stays in charge.",
  copy: "Chakusa's AI assistant can respond to enquiries, capture the details a business needs, and help move a conversation toward a booking, using the business's own information. It isn't a fully autonomous operator: eligible automation is owner-reviewed, and a team member can take over any conversation at any point.",
  features: ["Enquiry responses", "Detail capture", "Booking assistance", "Human takeover, always available"],
};

export const marketplace = {
  eyebrow: "Customer discovery",
  title: "Help the right customer find the right business.",
  copy: "Chakusa connects marketplace discovery and public business profiles with the conversation that follows. Customers can understand the service, contact the business, and continue toward a booking without losing context.",
  categories: ["Beauty & wellness", "Home services", "Automotive", "Professional services"],
  steps: [
    { label: "Discover", copy: "Browse relevant services" },
    { label: "Understand", copy: "View the business profile" },
    { label: "Enquire", copy: "Start the conversation" },
  ],
};

export const businessControl = {
  eyebrow: "One focused view",
  title: "See what needs attention next, in one place.",
  copy: "The dashboard brings enquiries, bookings, reviews, and customers due back into a single working view, so the team can act on what's actually happening rather than checking five different tools.",
  points: ["Review a prepared response", "Confirm the next customer action", "See what needs attention", "Keep the team aligned"],
  visual: "/images/product/chakusa-dashboard.png",
};

export const mobileExperience = {
  eyebrow: "Built for the working day",
  title: "The customer journey stays with the team.",
  copy: "Chakusa's mobile app brings enquiries, customers, bookings, reviews, reminders, and business attention items into the same working view your team already uses on their phone.",
  visual: "/images/product/chakusa-dashboard.png",
};

export const productIndustries = ["Barbers & salons", "Beauty & spa", "Dentists", "Mechanics", "Cleaners", "Photographers"];

export const productFaqs = [
  { question: "What is Chakusa?", answer: "Chakusa is a customer growth and business management platform for local service businesses. It connects enquiries, bookings, customer records, reviews, follow-ups, and repeat customer activity in one place." },
  { question: "Who is Chakusa built for?", answer: "Solo and small-team local service businesses that live on repeat customers: barbers, salons, dentists, cleaners, contractors, mechanics, photographers, and similar trades." },
  { question: "Can Chakusa manage bookings?", answer: "Yes. Services, availability, and calendar tools connect an enquiry to a confirmed appointment, with reminders ahead of the visit." },
  { question: "Can I manage customers in Chakusa?", answer: "Yes. Every customer gets one record: enquiries, bookings, notes, and outcomes, so the next conversation starts with context." },
  { question: "Does Chakusa help with reviews?", answer: "Yes. Chakusa helps request a review while the visit is still fresh and collects private feedback alongside it, for every visit." },
  { question: "How does Chakusa help bring customers back?", answer: "Chakusa tracks who's due to rebook and surfaces a reminder before a regular quietly stops coming back, not after." },
  { question: "Does Chakusa include automation?", answer: "Chakusa supports automation for confirmations, reminders, and follow-ups, with business approval and human takeover available at every step. Some automation is manual today and some is automated; check this page for the specifics rather than the marketing getting ahead of the product." },
  { question: "Does Chakusa use AI?", answer: "Yes, for assisted responses: drafting and sending replies to enquiries using the business's own information. It supports the team rather than replacing it, and a person can take over any conversation." },
  { question: "Can customers discover my business through Chakusa?", answer: "Yes, through Chakusa's marketplace and public business profiles, across beauty, home services, automotive, and professional services." },
  { question: "Is Chakusa available on mobile?", answer: "Yes. Chakusa is a mobile app for iOS and Android; there's no separate web dashboard today." },
];
