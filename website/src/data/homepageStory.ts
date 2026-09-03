// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION, STAGE 3 — homepage content.
// Structure and section rhythm from the approved Stitch homepage
// (chakusa_local_service_platform_growth_engine); every factual claim
// re-verified against the real product, not copied from Stitch's copy.
//
// Fabricated content removed, not replaced with different fabricated
// content:
// - "Connecting trusted local businesses with thousands of daily
//   customers" (top bar) — removed, no verified usage scale exists.
// - The "Maya Lin" testimonial + "14 hrs saved weekly" + "92% retention
//   after 3 months" — removed entirely, not softened. No verified real
//   Chakusa testimonial exists. Replaced with a real-capability section
//   in the same visual rhythm (independentStory below), not a
//   restyled fake quote.
// - "Converted to Booking in 4m", "+38% Off-Hours Rev", "Compounding
//   MRR" (real product's repeat revenue is the *business's*, never
//   Chakusa's own subscription revenue — Stitch's "MRR" label
//   conflated the two) — removed/reworded.
// - Final CTA's "Start your 14-day free trial" — there is no trial.
//   Real plans are Free/Pro/Business (src/data/pricing.ts); Free has no
//   expiry. Reworded to match the real Free plan.
// - Lifecycle step 4 ("Recover") described as fully "Automatic" —
//   softened; EXPO_PUBLIC_AUTOMATION_ENABLED is false in production
//   (confirmed in the Stage 1 audit), so this never claims unattended
//   autonomous sending.

export const heroCopy = {
  eyebrow: "The 2-in-1 platform for local services",
  title: "Where trusted local businesses and loyal customers meet.",
  body: "Chakusa connects customer discovery with full business management. Capture enquiries, keep bookings synced, follow up on what's outstanding, and build a customer relationship that lasts past the first visit, all in one place.",
};

export const heroTrust = [
  { icon: "shield", label: "No sentiment-gated reviews" },
  { icon: "smartphone", label: "One app, for customers and businesses" },
];

export interface LifecycleStep { number: string; icon: string; label: string; copy: string; tag: string }
export const lifecycleSteps: LifecycleStep[] = [
  { number: "01", icon: "explore", label: "Discover", copy: "A public business profile and marketplace listing so a customer can find and understand the business.", tag: "Marketplace listing" },
  { number: "02", icon: "event_available", label: "Book", copy: "Services, availability, and the calendar connect an enquiry to a confirmed appointment.", tag: "Booking & calendar" },
  { number: "03", icon: "tune", label: "Manage", copy: "Customer records, the team's calendar, and day-to-day dispatching in one working view.", tag: "Business dashboard" },
  { number: "04", icon: "contact_phone", label: "Recover", copy: "A missed call or a new enquiry becomes a lead flagged for attention, not a message that quietly disappears.", tag: "Owner-reviewed follow-up" },
  { number: "05", icon: "rate_review", label: "Review", copy: "Review requests go out while the visit is fresh, for every visit, never withheld based on how it's expected to go.", tag: "Never sentiment-gated" },
  { number: "06", icon: "repeat", label: "Retain", copy: "Chakusa surfaces customers who haven't rebooked in the expected window, before they quietly stop coming back.", tag: "Comeback reminders" },
  { number: "07", icon: "trending_up", label: "Grow", copy: "Repeat visits, referrals, and a business's own reputation compound the more of this loop actually runs.", tag: "The business's growth, not ours" },
];

export interface IndustryCard { title: string; icon: string; copy: string; href: string }
// Grounded in src/data/industries.ts's real 4 categories (Beauty,
// Professional, Home services, Automotive) and their real `examples`
// arrays — presented as 6 cards for visual rhythm, matching Stitch,
// without inventing a 5th or 6th real category.
export const industryCards: IndustryCard[] = [
  { title: "Barbers & Salons", icon: "content_cut", copy: "Recurring chair appointments, add-on services, and the regulars who come back every few weeks.", href: "/industries/beauty" },
  { title: "Spas & Beauty Clinics", icon: "spa", copy: "Treatment bookings, client history, and review requests sent while the visit is still fresh.", href: "/industries/beauty" },
  { title: "Dentists & Consultants", icon: "medical_services", copy: "Appointment confirmations, intake context, and recall reminders for check-ups that are due.", href: "/industries/professional" },
  { title: "Photographers & Creatives", icon: "photo_camera", copy: "Enquiry capture for shoot requests, booking confirmations, and a portfolio customers can find.", href: "/industries/professional" },
  { title: "Cleaners & Home Care", icon: "cleaning_services", copy: "Recurring visit scheduling, customer notes, and follow-up after every job.", href: "/industries/home-services" },
  { title: "Mechanics & Detailing", icon: "car_repair", copy: "Service enquiries, appointment scheduling, and customers reminded when their next service is due.", href: "/industries/automotive" },
];

export interface PlatformModule { icon: string; title: string; copy: string }
export const platformModules: PlatformModule[] = [
  { icon: "inbox", title: "Enquiries", copy: "A missed call or a new enquiry becomes a lead with the customer's details and what they asked about attached, so it stays visible until someone follows up." },
  { icon: "calendar_month", title: "Bookings & calendar", copy: "Services, availability, and the calendar connect an enquiry to a confirmed appointment, with reminders ahead of the visit." },
  { icon: "account_box", title: "Customer records", copy: "Every enquiry, booking, note, and outcome collects on one customer profile, so the next conversation starts with context." },
  { icon: "star_rate", title: "Reviews", copy: "Review requests go out while the visit is fresh, for every visit, with no gating based on expected sentiment." },
  { icon: "repeat", title: "Comeback reminders", copy: "Chakusa surfaces customers who haven't rebooked in the expected window, so a reminder can go out before they've quietly moved on." },
  { icon: "forum", title: "Prepared responses", copy: "Chakusa can prepare a message using the business's own template. A team member reviews and sends it, always." },
];

export const independentStory = {
  eyebrow: "Built for independent operators",
  title: "One place instead of five separate tools.",
  body: "Running a service business usually means a phone for calls, a notebook or spreadsheet for bookings, a separate app for reviews, and a mental list of who's overdue for a follow-up. Chakusa keeps enquiries, the calendar, customer history, and reviews connected, so switching between tools isn't the job anymore.",
};

export const ecosystemCopy = {
  eyebrow: "One app, two experiences",
  title: "One app. Two purpose-built modes.",
  body: "The same Chakusa app works as a customer discovering and booking local services, and as a business managing its own operation, never two separate apps.",
};

export const finalCta = {
  eyebrow: "Get started",
  title: "The modern standard for local service commerce.",
  body: "Whether you're looking for a trusted local service or ready to run your business on one connected platform, Chakusa is ready.",
  customer: { title: "Looking for a trusted service?", copy: "Explore local businesses with real reviews and upfront information.", label: "Explore local businesses" },
  business: { title: "Run a local business?", copy: "Start free. No card required. Capture enquiries, manage bookings, and bring customers back.", label: "Start free" },
};
