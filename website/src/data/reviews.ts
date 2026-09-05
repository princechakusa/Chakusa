// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION - Reviews feature page.
// Structure reproduced from the Stitch export
// (chakusa_reviews_transparent_un_gated_reputation_engine/code.html):
// hero + proof strip, 4-step lifecycle, "gating vs. Chakusa" comparison,
// an illustrative review-ledger example, industry adaptations, final CTA.
//
// Fabricated content from the Stitch source removed, not replaced with
// different fabricated content:
// - The hero's "100% Un-Gated / 0% Fake Review Risk / <3 Sec Sync"
//   stat strip - specific, unverifiable numbers. Replaced with the
//   actual policy facts (every visit gets a request; no rating-based
//   filtering; the business owns its profile).
// - "FTC ... Section 5" and "Google Business Profile" sync claims - no
//   confirmed integration exists; removed rather than asserted.
// - The named reviewers ("Marcus Vance", "Elena Rostova", "David
//   Chen"), their stock photos, specific star counts, invented
//   business name ("Heritage Trade Co. & Guild Partners"), and the
//   "4.96 / 5.0" and "1,428 bookings" aggregate stats - all fabricated.
//   Replaced with one clearly-labeled illustrative example, no invented
//   identity or photo attached.
// - "14-day fully featured testbed" - reworded because it implied a
//   no-strings-attached testbed rather than the real 14-day free
//   trial that converts to a paid plan; real plans are Starter / Pro
//   / Business, each with a 14-day free trial (see src/data/pricing.ts).
export const reviewsHero = {
  badge: "Reviews, without the gate",
  title: "Every customer gets asked. Every answer goes public.",
  emphasis: "No gate.",
  body: "Chakusa sends a review request after every completed visit, not just the ones a business expects to go well. What comes back is published to the business's own profile, star rating and all.",
};

export const reviewsProof = [
  { label: "Who gets asked", value: "Every visit", detail: "The same request flow" },
  { label: "Filtered by rating first", value: "Never", detail: "No sentiment screening" },
  { label: "Where reviews appear", value: "Chakusa profile", detail: "With the submitted score" },
];

export interface ReviewStep { number: string; icon: string; title: string; body: string; tag: string }
export const reviewSteps: ReviewStep[] = [
  { number: "01", icon: "check", title: "Visit marked complete", body: "The appointment is marked done in the business's Chakusa dashboard.", tag: "Business-triggered" },
  { number: "02", icon: "sms", title: "Review request prepared", body: "The customer gets the same short, direct invitation to rate the visit, never a selected subset.", tag: "No pre-screening" },
  { number: "03", icon: "star", title: "Customer responds", body: "The customer submits a 1–5 star rating and can add an optional note from the review link.", tag: "Rating + optional note" },
  { number: "04", icon: "profile", title: "Published to the profile", body: "The review appears on the business's public Chakusa profile with the score that was submitted.", tag: "Not filtered by score" },
];

export const gatingTrap = {
  title: "The trap of review gating",
  body: "Platforms that route only happy customers to a public review form, and quietly redirect everyone else to a private one, distort what the public sees.",
  points: [
    "Policy risk: major review platforms and consumer-protection regulators treat sentiment-based routing as a deceptive practice.",
    "Lost feedback: real service problems never reach the business because the complaint was filtered out before it could be seen.",
    "Credibility loss: customers increasingly discount a suspiciously perfect rating with no visible criticism at all.",
  ],
};

export const chakusaStandard = {
  title: "The Chakusa standard",
  body: "Equal treatment for every completed visit. A business's reputation reflects what customers actually experienced.",
  points: [
    "Every completed visit gets the same request, regardless of how it's expected to go.",
    "Businesses can respond publicly to any review, turning a rough visit into a visible, professional resolution.",
    "Reviews are tied to a real completed booking on the platform, not left open to anyone who stumbles onto the page.",
  ],
};

export interface ReviewLedgerEntry {
  trade: "barber" | "wellness" | "mechanic";
  avatar: string;
  reviewer: string;
  booking: string;
  specialist: string;
  rating: number;
  quote: string;
  tags: string[];
  time: string;
  reply?: string;
}

export const reviewLedger: { label: string; title: string; note: string; entries: ReviewLedgerEntry[] } = {
  label: "Product interface preview",
  title: "The feedback and reputation ledger",
  note: "Illustrative demo data, not real customers, bookings, or businesses.",
  entries: [
    {
      trade: "barber",
      avatar: "B",
      reviewer: "Demo customer",
      booking: "Completed booking",
      specialist: "Barbering example",
      rating: 5,
      quote: "The appointment started on time, the service was explained clearly, and the result matched what I asked for.",
      tags: ["Service: haircut and beard trim", "Visit marked complete", "Review submitted"],
      time: "Example entry",
      reply: "Thank you for the thoughtful feedback. We appreciate you taking the time to share your experience.",
    },
    {
      trade: "wellness",
      avatar: "W",
      reviewer: "Demo customer",
      booking: "Completed booking",
      specialist: "Wellness example",
      rating: 4,
      quote: "Booking was straightforward and the team made the next steps easy to understand.",
      tags: ["Service: wellness visit", "Optional written note", "Public profile"],
      time: "Example entry",
    },
    {
      trade: "mechanic",
      avatar: "A",
      reviewer: "Demo customer",
      booking: "Completed booking",
      specialist: "Automotive example",
      rating: 5,
      quote: "The work was explained before it began, and the final price matched the estimate I approved.",
      tags: ["Service: vehicle inspection", "Booking-linked", "Business can reply"],
      time: "Example entry",
    },
  ],
};

export interface ReviewIndustry { icon: string; title: string; body: string; points: string[] }
export const reviewIndustries: ReviewIndustry[] = [
  { icon: "cut", title: "Barbers & Salons", body: "Reviews tied to the completed appointment, not a generic storefront form.", points: ["Linked to the specific visit", "Visible on the public profile", "Business can reply publicly"] },
  { icon: "car", title: "Auto & Trades", body: "A finished job gets a review request the same way a haircut or a cleaning visit does.", points: ["Sent after job completion", "No rating-based filtering", "Public business response"] },
  { icon: "health", title: "Health & Wellness", body: "The same ungated request flow, sent respectfully and without pressure.", points: ["One request per visit", "Optional written feedback", "Never withheld by outcome"] },
  { icon: "clean", title: "Home & Cleaning", body: "Recurring visits each get their own review opportunity, not just the first one.", points: ["Per-visit requests", "Consistent request timing", "Owner-visible history"] },
];

export const reviewsCta = {
  label: "Start with honest reviews",
  title: "Build a reputation that reflects what actually happened.",
  body: "Turn on review requests for every completed visit. No gating, no filtering by expected rating.",
};
