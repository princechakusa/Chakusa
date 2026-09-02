// PROGRAM: POWERFUL FEATURES, FEATURE PAGE 01, ENQUIRIES & LEADS.
// Product-truth ledger, same convention as data/product.ts and
// data/how-it-works.ts: every claim below is checked against the actual
// backend and mobile source, not assumed from an earlier page.
//
// Verified against the repository on this pass:
// - prisma/schema.prisma's Lead model: status is new/contacted/booked/won/
//   lost (LeadStatus enum), plus source, missedCallTime, serviceRequested,
//   urgency, estimatedValue, paymentStatus/paidAmount, notes, and
//   contactedAt/bookedAt/wonAt/lostAt timestamps.
// - src/modules/dashboard/attentionCenter.service.ts: a lead with status
//   "new" is exactly what "missed_call_followup" surfaces as needing
//   attention, oldest first.
// - src/modules/leads/leads.service.ts's generateLeadMessage +
//   src/lib/messageRendering.ts: the lead "prepare message" action fills a
//   business's own saved template (or an industry default) with the
//   customer's name, the business name, the requested service, and the
//   business phone number. This is template rendering, not an AI model, so
//   this page never calls it "AI-assisted" or "AI-generated" language is
//   reserved for the separate AI-drafted conversation replies elsewhere in
//   the product (see below), which this page only links to.
// - src/modules/public/publicBusinessProfile.service.ts's
//   submitPublicContactForm: a message sent through a business's public
//   Chakusa profile creates a lead automatically (source: "public_profile").
// - mobile/src/services/callDetectionSync.ts + prisma's Lead.clientEventId:
//   on Android, with the Recovery Engine permission granted, a missed call
//   is queued on-device and synced into a lead automatically, idempotent
//   on a per-call client event id. iOS has no equivalent, there is no
//   OS-level call log API to build one on.
// - src/lib/leadSources.ts: only "missed_call" and "public_profile" are
//   recognized, automation-eligible source constants. Any other channel
//   (WhatsApp, a social message, a walk-in) is not automatically captured
//   and must be entered as a lead manually.
// - mobile/eas.json: EXPO_PUBLIC_AUTOMATION_ENABLED is "false" in the
//   production and preview build profiles. Backend automation scheduling
//   exists (src/lib/automation/scheduler.ts, entitlement-gated per
//   subscription plan) but is not switched on for the shipped app, so this
//   page never describes a follow-up as sent automatically.
// - mobile/src/screens/LeadDetailCorrectScreen.tsx: the real button label
//   is "Prepare message" (then Copy / Open SMS / Open WhatsApp), status
//   changes are explicit tap-to-confirm buttons from
//   getAllowedLeadTransitions, won leads get payment tracking
//   (paid/partially paid/unpaid) and a "Bring them back" reminder nudge.
// - mobile/src/screens/LeadsScreen.tsx: filters are All/New/Contacted/
//   Booked/Won/Lost, plus a search box across the currently loaded leads.
// - mobile/src/screens/CustomerProfileScreen.tsx: "Every lead, message,
//   review, reminder, and payment for this customer will show up here" is
//   real, shipped copy, not invented for this page.
// - prisma/schema.prisma's Appointment model has no leadId field. A lead
//   and a resulting appointment are connected through the shared Customer
//   record, not a direct database link, and marking a lead Won does not by
//   itself create an appointment. This page describes that connection
//   accordingly, not as one automatic step.
// - src/modules/aiAgent/aiAgent.routes.ts: AI-drafted conversation replies
//   are a real, separate capability (takeover/resume/transfer/reply,
//   approve/reject a drafted run) that operates on conversations, not
//   directly on the Lead record. This page links to it as a connected
//   capability rather than describing it as part of how a lead's message
//   gets prepared.

export interface EnquiryStory { id: string; step: string; eyebrow: string; title: string; copy: string; features: string[]; next: string; visual: string | null; visualLabel: string }

// Same shape as data/product.ts's ProductStory, reusing
// components/product/ProductFeature.astro directly for these three
// sections rather than writing a near-duplicate component.
export const enquiryStories: EnquiryStory[] = [
  {
    id: "attention",
    step: "01",
    eyebrow: "Know what needs attention",
    title: "The owner shouldn't have to remember every unfinished conversation.",
    copy: "Any lead still marked New is a customer who hasn't heard back yet. It stays visible in your attention view until you contact them, so a busy day doesn't quietly become a missed opportunity.",
    features: ["Needs-attention view", "New, oldest first", "Stays visible until acted on", "One place, not five tools"],
    next: "See exactly what's known about the customer before you respond.",
    visual: null,
    visualLabel: "Leads needing attention",
  },
  {
    id: "understand-lead",
    step: "02",
    eyebrow: "Understand the lead",
    title: "Everything you need before you call back.",
    copy: "Service requested, urgency, when the call came in, estimated value, and, if this person has contacted the business before, their full history. No guessing what they wanted.",
    features: ["Service and urgency", "Missed-call time", "Estimated value", "Linked customer history"],
    next: "Prepare a response without starting from a blank screen.",
    visual: null,
    visualLabel: "Lead detail and context",
  },
  {
    id: "prepare-response",
    step: "03",
    eyebrow: "Prepare the next response",
    title: "Chakusa prepares the message. You decide when it goes.",
    copy: "Prepare message fills in your own saved template, or an industry default if you haven't set one, with the customer's name, your business name, and the service they asked about. Nothing sends until you choose Copy, Open SMS, or Open WhatsApp.",
    features: ["Your own templates", "Filled in automatically", "Copy, SMS, or WhatsApp", "You always send it"],
    next: "A response moves the lead forward, one status at a time.",
    visual: null,
    visualLabel: "Prepared message ready to send",
  },
];

export interface LifecycleStage {
  id: "new" | "contacted" | "booked" | "won" | "lost";
  label: string;
  description: string;
}

export const lifecycleStages: LifecycleStage[] = [
  { id: "new", label: "New", description: "An enquiry just arrived and hasn't been followed up yet." },
  { id: "contacted", label: "Contacted", description: "The business has reached out and is waiting to hear back." },
  { id: "booked", label: "Booked", description: "The enquiry has a confirmed appointment attached." },
  { id: "won", label: "Won", description: "The visit happened. Payment can be tracked from here." },
  { id: "lost", label: "Lost", description: "This enquiry didn't convert. It stays on record, not deleted." },
];

export interface EnquiryFaq { question: string; answer: string }

export const enquiriesFaqs: EnquiryFaq[] = [
  { question: "What counts as a lead in Chakusa?", answer: "A missed call, a message through your public Chakusa profile, or any enquiry a team member adds by hand. Each one becomes a lead record with the customer's details and the service they asked about." },
  { question: "How does Chakusa help with missed customer enquiries?", answer: "A missed enquiry shows up as a lead that still needs a first response, surfaced in your attention view until you act on it. On Android, a missed call can be added automatically if you turn on the Recovery Engine permission; on iOS, and for any other channel, you add it in a few taps." },
  { question: "Can I see which leads need attention?", answer: "Yes. Any lead still marked New is a customer who hasn't heard back yet, and it stays visible until you contact them or mark it as lost." },
  { question: "Can I track a lead from new to booked?", answer: "Yes. A lead moves through New, Contacted, Booked, Won, or Lost, and every change is a deliberate tap, never automatic." },
  { question: "Does Chakusa reply to leads automatically?", answer: "No. Chakusa can prepare a message for you to review, but nothing sends until you choose Copy, Open SMS, or Open WhatsApp yourself." },
  { question: "Can Chakusa help prepare follow-up messages?", answer: "Yes. Prepare message fills in your own saved template, or an industry default if you haven't set one, with the customer's name, your business name, and the service they asked about. You still decide when and how to send it." },
  { question: "Can a lead become a customer record?", answer: "Yes. Once a lead is linked to a customer, every message, booking, review, and reminder for that person collects on one profile, so the next conversation isn't starting from nothing." },
  { question: "Can I search my leads?", answer: "Yes. You can search by customer name or service, and filter by New, Contacted, Booked, Won, or Lost." },
  { question: "Does Chakusa work for different service businesses?", answer: "Yes. Barbers, salons, dentists, mechanics, cleaners, spas, and similar local service businesses all use the same lead workflow, since a missed enquiry looks the same regardless of trade." },
];

export interface IndustryEnquiryExample { title: string; example: string }

export const industryEnquiryExamples: IndustryEnquiryExample[] = [
  { title: "Barber", example: "A customer calls mid-cut. Chakusa keeps the missed call as a lead so it isn't just gone by closing time." },
  { title: "Salon", example: "A client asks about a colour appointment while the front desk is with someone else. The enquiry waits as a lead, not a missed message." },
  { title: "Dentist", example: "A treatment enquiry comes in between patients. It sits ready for the front desk to follow up between appointments." },
  { title: "Mechanic", example: "A repair enquiry arrives while the workshop is mid-job. It's still there, with the requested service attached, once there's a moment to call back." },
  { title: "Cleaner", example: "A quote request comes in during a job. It's logged as a lead instead of relying on someone remembering to call back later." },
  { title: "Spa", example: "A customer asks about treatment availability outside opening hours. The enquiry is waiting, not lost overnight." },
];
