// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION - AI Assistant feature page.
// Structure reproduced from the Stitch export
// (chakusa_ai_assistant_quiet_grounded_intelligence_for_local_trades/
// code.html): hero + proof strip, three practical-role cards, a
// governance/policy section, domain-adapted trade cards, final CTA.
//
// This is the one feature page where the real backend (src/lib/ai/
// agent/customerAgent.ts, agentTools.ts, policyDefaults.ts) is more
// capable than most others on the site: there is a real AI Customer
// Agent with real tools (check_availability, book_appointment), a real
// policy engine (DRAFT / APPROVAL / AUTONOMOUS modes, policy
// checkpoints, human takeover/resume/transfer), and mutating actions
// that can require approval before they happen. DEFAULT_MODE is
// "DRAFT" - the assistant drafts, a human reviews, unless a business
// deliberately turns on a more autonomous mode. That default, and the
// existence of human takeover at every step, is the load-bearing fact
// this page is built around.
//
// Fabricated content from the Stitch source removed, not replaced with
// different fabricated content:
// - "0% Hallucination Tolerance," "98.4% Enquiry-to-Booking Conversion
//   Accuracy," "14 Hrs Reclaimed Weekly" - unverifiable, specific
//   numbers. Replaced with the real, confirmed facts (default mode,
//   real tools, approval on mutating actions).
// - The named conversations (Marcus Vance, John S, Sarah J) and the
//   "Julian" photo testimonial with a live "AI Chair Assistant" demo -
//   fabricated identities and an unconfirmed autonomous dispatch
//   scenario. Removed.
// - Specific per-industry "Average Setup Time" figures - unverifiable;
//   removed.
// - "Book a Live Walkthrough" - no such scheduling flow is confirmed to
//   exist; CTA points to the real get-started flow and product page
//   instead, and describes a 14-day free trial, not a permanent free
//   plan.
export const aiHero = {
  badge: "AI with human oversight",
  title: "An AI assistant for customer conversations, with your rules and a human in the loop.",
  body: "Chakusa's AI assistant drafts replies from your real services, hours, and pricing. By default, nothing goes out or gets booked without your team seeing it first.",
};

export const aiProof = [
  { label: "Default mode", value: "Draft, you review" },
  { label: "Real tools", value: "Check availability, book" },
  { label: "Escalation", value: "Handed to your team" },
];

export interface AIRole { icon: string; title: string; body: string }
export const aiRoles: AIRole[] = [
  { icon: "chat", title: "Off-hours questions", body: "Drafts an answer to common questions using your published services, hours, and policies, ready for your team to send." },
  { icon: "calendar", title: "Availability and booking", body: "Can check real open slots and book an appointment using the same booking rules your team uses, with approval required by default." },
  { icon: "handoff", title: "Human hand-off", body: "Complex requests, price negotiation, or anything outside its rules gets escalated straight to your team." },
];

export const governance = {
  label: "Deterministic governance",
  title: "Configurable oversight, not a black box.",
  body: "The assistant runs in Draft mode by default: every reply is prepared for review, not sent automatically. Businesses that want more autonomy can turn on approval workflows or a more autonomous mode, one action at a time.",
  points: [
    { title: "Draft by default", body: "New conversations start in Draft mode. A human reviews before anything is sent." },
    { title: "Approval on real actions", body: "Actions that change something, like booking an appointment, can require sign-off before they happen." },
    { title: "Human takeover, anytime", body: "Your team can take over any conversation, resume the assistant, or hand it to a specific team member." },
  ],
};

export interface AIIndustry { icon: string; title: string; body: string }
export const aiIndustries: AIIndustry[] = [
  { icon: "cut", title: "Barbering & Hair Parlors", body: "Answers on chair availability, service length, and pricing, drawn from your real service list." },
  { icon: "car", title: "Independent Garages", body: "Fields questions on common services and hours, escalating anything requiring a real diagnostic." },
  { icon: "briefcase", title: "Boutique Practices", body: "Handles routine scheduling questions while keeping clinical or sensitive requests with your team." },
];

export const aiCta = {
  label: "Set your own rules",
  title: "An assistant that works from your real information, with your team always in the loop.",
  body: "Start in Draft mode and see exactly what the assistant would say before anything reaches a customer.",
};
