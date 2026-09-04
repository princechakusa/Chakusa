// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION - Mobile App feature page.
// Structure adapted from the Stitch export
// (chakusa_mobile_app_dual_experience_in_one_app/code.html): hero +
// proof strip, two device-mode previews, a 6-capability grid, final
// "future release" CTA.
//
// Confirmed against the repo: mobile/app.json (bundleIdentifier
// com.chakusa.mobile, real iOS/Android config) and the website's own
// existing get-started.astro and SiteFooter.astro, both of which
// already say "App Store: future release" / "Google Play: future release."
// The app is not live in either store yet - this page must not imply
// otherwise.
//
// Fabricated content from the Stitch source removed, not replaced with
// different fabricated content:
// - "4.9 avg across 48,000+ App Store reviews," "<180ms latency,"
//   "end-to-end encrypted appointments," "SOC2 Certified," "Zero
//   Transaction Markups," "Bank-Grade Settlement" - unverifiable
//   claims, some inconsistent with an app that isn't published yet.
//   Removed.
// - "Chakusa Rewards / 450 pts available," named businesses (Heritage
//   Craft Barbers, Precision EuroTech, Luxe Dental Studio) with prices
//   and distances, and "Direct Merchant Payouts" (no payment
//   processing feature confirmed) - fabricated or unconfirmed.
//   Removed.
// - A working "Install the Universal App Today" QR code and live store
//   badges - the app isn't published; replaced with an honest
//   "future release" notice matching the rest of the site.
export const mobileHero = {
  badge: "One app, two experiences",
  title: "One app. Two experiences.",
  body: "The same Chakusa app works as a customer discovering and booking local services, and as a business running its own operation. No second login, no separate app.",
};

export const mobileProof = [
  { label: "Platforms", value: "iOS and Android" },
  { label: "Accounts needed", value: "One" },
  { label: "Availability", value: "Release planned" },
];

export const mobileModes = {
  customer: {
    label: "Customer mode",
    title: "Browse, book, and keep track of visits.",
    points: ["Find nearby businesses and real availability", "Book directly from a business's public profile", "See upcoming and past appointments in one place"],
  },
  business: {
    label: "Business mode",
    title: "Run the day from your pocket.",
    points: ["Today's schedule and new enquiries at a glance", "Respond to enquiries with your team's oversight", "Everything from the same dashboard as the web app"],
  },
};

export interface MobileCapability { icon: string; badge: string; title: string; body: string }
export const mobileCapabilities: MobileCapability[] = [
  { icon: "search", badge: "Customer", title: "Real-time availability", body: "See actual open slots for a business, not an estimate." },
  { icon: "inbox", badge: "Business", title: "Enquiry capture on the go", body: "New enquiries reach your team's dashboard immediately." },
  { icon: "star", badge: "Both", title: "Ungated reviews", body: "Every completed visit can leave a review, never filtered by rating." },
  { icon: "repeat", badge: "Customer", title: "Simple rebooking", body: "Book a past service again in a few taps." },
  { icon: "note", badge: "Business", title: "Customer records", body: "Notes and visit history stay attached to each customer's profile." },
  { icon: "task", badge: "Business", title: "Task-based automation", body: "Workflows create tasks for your team, reviewed before anything sends." },
];

export const mobileCta = {
  label: "Mobile release",
  title: "The Chakusa app is coming to iOS and Android.",
  body: "In the meantime, everything in Chakusa works from the web, on any device.",
};
