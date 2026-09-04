// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION - Business Control feature
// page. Structure adapted from the Stitch export
// (chakusa_business_control_growth_management_hub/code.html): hero +
// proof strip, an attention-center spotlight, a "how the day runs"
// 4-step flow, dual dashboard-control cards, final CTA.
//
// Grounded against src/modules/dashboard/attentionCenter.service.ts's
// real AttentionCategory set (missed_call_followup, customer_due,
// review_opportunity, payment_outstanding) - that's the real "what
// needs attention" list a business owner sees, not a live-updating
// dashboard of invented bookings and revenue figures.
//
// Fabricated content from the Stitch source removed, not replaced with
// different fabricated content:
// - The full dashboard mockup with specific invented numbers ("14
//   Bookings Today," "86.4% Retention Health," "4.98 ★ / 342 Verified")
//   and named leads/customers/reviewers (Marcus Vance, David Miller,
//   Rachel Thorne) - replaced with the real, generic attention
//   categories and one illustrative example.
// - "Autonomous AI Control / Quiet AI Assistant Configuration" implying
//   the AI acts fully on its own - inconsistent with the real product
//   (Draft mode by default, human review); reframed to match
//   /features/ai-assistant's honest description.
// - The "Sarah Jenkins" testimonial with photo and "+16% Repeat
//   Clients" / "11 Hours/Wk" stats - a fabricated identity and outcome.
//   Removed, not replaced.
// - "Start Free for 14 Days" is now owner-approved trial language, but
//   it must mean a time-limited 14-day free trial that converts to a
//   paid plan, not a permanent free plan. The CTA points to the real
//   get-started flow.
export const controlHero = {
  badge: "One dashboard, not five tabs",
  title: "Everything that needs your attention, in one place.",
  body: "Enquiries, bookings, customers, and reviews connect to a single dashboard, so nothing important gets missed between tools.",
};

export const controlProof = [
  { label: "What it tracks", value: "Enquiries, bookings, reviews" },
  { label: "Who acts on it", value: "You and your team" },
  { label: "Sends automatically", value: "Never" },
];

export interface AttentionCategory { icon: string; title: string; body: string }
export const attentionCategories: AttentionCategory[] = [
  { icon: "phone", title: "Missed call follow-up", body: "A lead came in and hasn't been followed up with yet." },
  { icon: "repeat", title: "Customer due for a rebook", body: "A regular has passed their expected rebooking window." },
  { icon: "star", title: "Review opportunity", body: "A completed visit is ready for a review request." },
  { icon: "invoice", title: "Payment outstanding", body: "A completed job still has an unpaid balance." },
];

export const dayFlow = {
  label: "How the day actually runs",
  title: "One list of what needs a decision today.",
  body: "Instead of checking four different tools, your team works from one attention list, prioritized by what's actually time-sensitive.",
};

export interface ControlCard { icon: string; title: string; points: string[] }
export const controlCards: ControlCard[] = [
  { icon: "calendar", title: "Schedule at a glance", points: ["Today's appointments in one view", "Team availability alongside bookings", "Cancellations and reschedules surfaced"] },
  { icon: "assistant", title: "AI assistance, reviewed by you", points: ["Drafts replies from your real information", "Draft mode by default, not autonomous", "Your team approves before anything sends"] },
];

export const controlCta = {
  label: "Run your day from one place",
  title: "Bring enquiries, bookings, customers, and reviews into one dashboard.",
  body: "Set up your business once, and the dashboard keeps everything connected from day one.",
};
