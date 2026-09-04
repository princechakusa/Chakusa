// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION, STAGE 3B - pixel-level
// correction pass. Structure and section rhythm from the approved Stitch
// homepage (chakusa_local_service_platform_growth_engine), re-extracted
// directly from its code.html this time (not approximated from the
// screenshot), matched class-for-class where the content is honest and
// the copy is real Chakusa capability, not Stitch's fabricated claims.
//
// Fabricated content removed, not replaced with different fabricated
// content - this list is unchanged from Stage 3, still locked:
// - "Connecting trusted local businesses with thousands of daily
//   customers" (top bar) - removed.
// - The "Maya Lin" testimonial + photo + "14 hrs saved weekly" + "92%
//   retention after 3 months" - removed entirely.
// - Every card's embedded fake conversation/mock-data content ("Can you
//   fit in 2 brake rotor replacements", "Rescue Rate +38% Off-Hours
//   Rev", "Compounding MRR", specific "Cadence Engine" cadences like
//   "Every 3-4 Weeks" presented as measured facts) - the STRUCTURE (a
//   small nested preview panel, a bottom stat row) is reproduced; the
//   specific fabricated numbers/dialogue inside it are not.
// - The final CTA's "14-day free trial" was removed at Stage 3 because
//   no trial existed yet. Superseded: a real 14-day free trial now
//   applies to all three plans (see src/data/pricing.ts), so this
//   claim is no longer fabricated where it appears elsewhere on the
//   site.

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

export interface IndustryCard { title: string; icon: string; copy: string; stat1Label: string; stat1Value: string; stat2Label: string; stat2Value: string; href: string }
export const industryCards: IndustryCard[] = [
  { title: "Barbers & Salons", icon: "content_cut", copy: "Recurring chair appointments, add-on services, and the regulars who come back every few weeks.", stat1Label: "Typical cadence", stat1Value: "3-4 weeks", stat2Label: "Real category", stat2Value: "Beauty", href: "/industries/beauty" },
  { title: "Spas & Beauty Clinics", icon: "spa", copy: "Treatment bookings, client history, and review requests sent while the visit is still fresh.", stat1Label: "Typical cadence", stat1Value: "Per treatment", stat2Label: "Real category", stat2Value: "Beauty", href: "/industries/beauty" },
  { title: "Dentists & Consultants", icon: "medical_services", copy: "Appointment confirmations, intake context, and recall reminders for check-ups that are due.", stat1Label: "Typical cadence", stat1Value: "Recall-based", stat2Label: "Real category", stat2Value: "Professional", href: "/industries/professional" },
  { title: "Photographers & Creatives", icon: "photo_camera", copy: "Enquiry capture for shoot requests, booking confirmations, and a portfolio customers can find.", stat1Label: "Typical cadence", stat1Value: "Per session", stat2Label: "Real category", stat2Value: "Professional", href: "/industries/professional" },
  { title: "Cleaners & Home Care", icon: "cleaning_services", copy: "Recurring visit scheduling, customer notes, and follow-up after every job.", stat1Label: "Typical cadence", stat1Value: "Weekly / bi-weekly", stat2Label: "Real category", stat2Value: "Home services", href: "/industries/home-services" },
  { title: "Mechanics & Detailing", icon: "car_repair", copy: "Service enquiries, appointment scheduling, and customers reminded when their next service is due.", stat1Label: "Typical cadence", stat1Value: "Mileage-based", stat2Label: "Real category", stat2Value: "Automotive", href: "/industries/automotive" },
];

export interface PlatformModule { icon: string; title: string; copy: string; previewLabel: string; previewBody: string; statLabel: string; statValue: string }
export const platformModules: PlatformModule[] = [
  { icon: "inbox", title: "Enquiries", copy: "A missed call or a new enquiry becomes a lead with the customer's details and what they asked about attached.", previewLabel: "New enquiry", previewBody: "Stays flagged until someone follows up, never silently dropped.", statLabel: "Response", statValue: "Owner-reviewed" },
  { icon: "calendar_month", title: "Bookings & calendar", copy: "Services, availability, and the calendar connect an enquiry to a confirmed appointment.", previewLabel: "Booking synced", previewBody: "Reminders go out ahead of the visit automatically.", statLabel: "Sync", statValue: "Google & Apple Cal" },
  { icon: "account_box", title: "Customer records", copy: "Every enquiry, booking, note, and outcome collects on one customer profile.", previewLabel: "Customer history", previewBody: "The next conversation starts with context, not a blank slate.", statLabel: "Export", statValue: "CSV, 1-click" },
  { icon: "star_rate", title: "Reviews", copy: "Review requests go out while the visit is fresh, for every visit.", previewLabel: "Zero gating", previewBody: "Never withheld based on expected sentiment.", statLabel: "Policy", statValue: "Ungated, always" },
  { icon: "repeat", title: "Comeback reminders", copy: "Chakusa surfaces customers who haven't rebooked in the expected window.", previewLabel: "Due for a visit", previewBody: "A reminder goes out before they've quietly moved on.", statLabel: "Trigger", statValue: "Rebooking window" },
  { icon: "forum", title: "Prepared responses", copy: "Chakusa can prepare a message using the business's own template.", previewLabel: "Message ready", previewBody: "A team member reviews and sends it, always.", statLabel: "Sending", statValue: "Never automatic" },
];

export const independentStory = {
  badge: "Built for independent operators",
  title: "One place instead of five separate tools.",
  body: "Running a service business usually means a phone for calls, a notebook or spreadsheet for bookings, a separate app for reviews, and a mental list of who's overdue for a follow-up. Chakusa keeps enquiries, the calendar, customer history, and reviews connected, so switching between tools isn't the job anymore.",
};

export const ecosystemCopy = {
  eyebrow: "Unified ecosystem",
  title: "One app. Two purpose-built modes.",
  body: "The same Chakusa app works as a customer discovering and booking local services, and as a business managing its own operation, never two separate apps.",
};

export const finalCta = {
  eyebrow: "Get started",
  title: "The modern standard for local service commerce.",
  body: "Whether you're looking for a trusted local service or ready to run your business on one connected platform, Chakusa is ready.",
  customer: { title: "Looking for a trusted service?", copy: "Explore local businesses with real reviews and upfront information.", label: "Explore local businesses" },
  business: { title: "Run a local business?", copy: "Try Starter free for 14 days. Capture enquiries, manage bookings, and bring customers back.", label: "Start free trial" },
};
