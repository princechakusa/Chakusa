// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION — Help page (new).
// Structure adapted from the newest Stitch export's Help Center: hero
// with search + character illustration, category grid, FAQ, contact
// CTA.
//
// Fabricated content removed, not replaced with different fabricated
// content: Stitch's category cards claim specific article counts
// ("14 Reference Guides," "22 Operational Docs," "9 Verification
// Specs") and stats ("2.1s Latency," "100% Verified," "Quiet AI" with
// no basis) - none of that exists since there is no actual knowledge
// base of articles behind this page yet. Categories instead link
// straight to the real page that answers that topic (the relevant
// feature page or FAQ section), and the search bar is a real, working
// filter over the FAQ list below it rather than a fake "protocol
// search" implying a large document repository.
export const helpHero = {
  badge: "Knowledge & support",
  title: "How can we help your business run smoothly?",
  body: "Guides, booking help, and account questions for service businesses and their customers.",
  searchPlaceholder: "Search common questions…",
};

export interface HelpCategory { icon: string; title: string; body: string; href: string }
export const helpCategories: HelpCategory[] = [
  { icon: "calendar", title: "Getting started", body: "Setting up your business, services, and team for the first time.", href: "/get-started" },
  { icon: "inbox", title: "Enquiries & leads", body: "How a missed call or enquiry becomes something you can act on.", href: "/features/enquiries" },
  { icon: "calendar2", title: "Bookings & calendar", body: "Availability, scheduling, confirmations, and rescheduling.", href: "/features/bookings" },
  { icon: "users", title: "Customers", body: "Customer records, notes, and history.", href: "/features/customers" },
  { icon: "star", title: "Reviews", body: "How review requests work, and why they're never gated.", href: "/features/reviews" },
  { icon: "sparkle", title: "Automation & AI", body: "What workflows and the AI assistant can and can't do on their own.", href: "/features/automation" },
  { icon: "shield", title: "Privacy & data", body: "What Chakusa collects, and how to request or export your data.", href: "/privacy" },
  { icon: "csvexport", title: "Billing & plans", body: "Starter, Pro, and Business plans, and how billing works.", href: "/pricing" },
];

export const helpFaqs = [
  { question: "How does Chakusa protect against double bookings?", answer: "Bookings check the business's real availability and rules before confirming, so the same slot can't be booked twice." },
  { question: "Do customers need an account to book an appointment?", answer: "No. A customer can book directly from a business's public profile without creating a Chakusa account first." },
  { question: "What makes Chakusa's reviews un-gated?", answer: "Every completed visit gets the same review request, never filtered or withheld based on how the visit is expected to go." },
  { question: "Does the AI assistant ever act completely on its own?", answer: "No. It drafts in Draft mode by default, and a human reviews before anything is sent or booked." },
];

export const helpContact = {
  label: "Still have questions?",
  title: "Reach the Chakusa team directly.",
  body: "Real questions get a real person. Email reaches us, not a ticket queue.",
};
