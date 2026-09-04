// Customer-facing counterpart to businessStitch.ts, reusing the same
// visual system (sb- prefixed CSS, business-stitch.css) for parity
// with /business, but grounded entirely in real, verified product
// behavior. Unlike businessStitch.ts, nothing here is a placeholder
// for content review - every number, name, and claim below is either
// a real product fact or explicitly labeled as an illustrative
// example, matching this site's locked content-accuracy discipline
// (see e.g. src/data/customers.ts, src/data/pricing.ts).
export const clientModules = [
  { label: "Discover", href: "#discover", icon: "search" },
  { label: "Bookings", href: "#bookings", icon: "event_available" },
  { label: "Messages", href: "#messages", icon: "chat" },
  { label: "Reviews", href: "#reviews", icon: "star_rate" },
  { label: "Loyalty", href: "#loyalty", icon: "repeat" },
  { label: "Your profile", href: "#profile", icon: "person" },
];

// Feature highlights, not fabricated KPIs - the business dashboard's
// "93% Capacity" / "$860 Value" style numbers have no customer-side
// equivalent that's real, so this uses the same 4-card layout for
// genuine, verifiable facts about how the marketplace works instead.
export const clientHighlights = [
  { label: "To book", value: "No account needed", note: "Browse and book directly from a public profile", icon: "event_available" },
  { label: "Reviews", value: "Ungated", note: "Every completed visit can leave a review, not filtered by rating", icon: "star_rate" },
  { label: "Pricing", value: "Set by the business", note: "See real services and prices before you book", icon: "sell" },
  { label: "Cost to browse", value: "Free", note: "No subscription or fee to discover or message a business", icon: "storefront" },
];

// Illustrative marketplace listings - generic business names, not real
// ones, matching the convention used for the homepage's "Customer
// view" card and the Customers feature page's illustrative profile.
export const clientListings = [
  { name: "Example Barber Co.", category: "Barbershop", note: "Public profile with real services and pricing", state: "3 slots today", action: "View profile", tone: "coral" },
  { name: "Example Auto Care", category: "Automotive", note: "Book a diagnostic or routine service", state: "Next opening tomorrow", action: "View profile", tone: "teal" },
  { name: "Example Wellness Studio", category: "Health & wellness", note: "See real reviews from other customers", state: "12 verified reviews", action: "View profile", tone: "slate" },
];

export const clientBookings = [
  { time: "Today", period: "", title: "Example booking with Example Barber Co.", detail: "Confirmed directly through the business's calendar", status: "Confirmed", tone: "complete" },
  { time: "Past", period: "", title: "Example past visit", detail: "Eligible for a review once completed", status: "Completed", tone: "progress" },
];

export const clientReviews = [
  { name: "Illustrative example", body: "Ungated reviews mean every customer who completes a visit can leave one - not just customers a business chooses to ask.", meta: "Not a real review - shown to demonstrate the format" },
];

// The lifecycle used consistently across the site (homepage,
// /about, /how-it-works): discover through to return.
export const clientJourney = [
  { number: "01", title: "Discover", body: "Find a local business by service and location in the marketplace, no account required to browse.", signal: "Public profile, real services and pricing", tone: "coral" },
  { number: "02", title: "Book or enquire", body: "Book directly into the business's real calendar, or send an enquiry if you have questions first.", signal: "Booking reaches the business immediately", tone: "teal" },
  { number: "03", title: "Get the service", body: "The business has your enquiry or booking details already, no repeating yourself.", signal: "Context carried through to the visit", tone: "slate" },
  { number: "04", title: "Review and return", body: "Leave an honest review after a completed visit, and get a reminder if you're due to come back.", signal: "Review requests are never rating-filtered", tone: "solid" },
];

export const clientControls = [
  { title: "Personalization", state: "On by default", body: "The app can remember preferences to personalize responses from the in-app assistant." },
  { title: "Conversation memory", state: "On by default", body: "You can turn off personalization and conversation memory in your app settings at any time (see AI Disclosure)." },
  { title: "Messaging opt-out", state: "Always available", body: "Reply STOP to any business's messages and Chakusa registers the opt-out automatically." },
];

export const clientLoyalty = [
  { title: "Points balance", state: "Per business", body: "Loyalty points and history are tracked per business you visit, not shared across the marketplace." },
  { title: "Redemption", state: "Business-controlled", body: "Each business sets its own point values, rewards, and expiry for its own loyalty program." },
  { title: "Cash value", state: "None", body: "Loyalty points have no cash value and can't be exchanged for cash, matching the Terms of Service." },
];
