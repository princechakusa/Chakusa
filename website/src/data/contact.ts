// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION — Contact page (new).
// Structure adapted from the newest Stitch export's Contact page: hero
// + resolution-stream category cards + FAQ, reproduced honestly.
//
// Stitch's version includes a fully interactive "Send a Direct
// Dispatch" ticket form (name/email/business/topic/message fields)
// with a "90-second SLA," a live regional-support map, and per-channel
// response-time promises ("< 2h Response Avg," "Fast-track onboarding,"
// "Priority resolution"). None of that exists: there is no backend to
// receive a web form submission, no support-ticket system, and no
// confirmed response-time SLA. Building a form that looks functional
// but silently goes nowhere would be worse than not having one, so
// this page uses real mailto links instead, the same pattern already
// used on the About page's "Get in touch" section.
export const contactHero = {
  badge: "Direct, human support",
  title: "Speak with the Chakusa team.",
  body: "Real questions get a real person, not a ticket queue. Reach out on the channel that fits what you need.",
};

export interface ContactChannel { icon: string; title: string; body: string; email: string }
export const contactChannels: ContactChannel[] = [
  { icon: "inbox", title: "General support", body: "Questions about your account, the app, or anything not covered below.", email: "support@chakusarecovery.com" },
  { icon: "calendar", title: "Business onboarding", body: "Setting up your business, services, or team for the first time.", email: "support@chakusarecovery.com" },
  { icon: "shield", title: "Privacy & data", body: "Data access requests, export requests, or privacy questions.", email: "privacy@chakusarecovery.com" },
];

export const contactFaqs = [
  { question: "How fast will I hear back?", answer: "We don't promise a specific response time yet. Email reaches a real person, not an automated queue." },
  { question: "Can I request my data or ask it be deleted?", answer: "Yes. Email privacy@chakusarecovery.com and we'll walk you through it." },
  { question: "Is there a phone line?", answer: "Not yet. Email is the reliable way to reach us today." },
];
