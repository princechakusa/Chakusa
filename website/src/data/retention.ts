// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION — Retention feature page.
// Structure reproduced from the Stitch export
// (chakusa_retention_automated_repeat_business_engine/code.html): hero
// + proof strip, a 5-step "anatomy of a rebook", industry cadence
// examples, final CTA.
//
// The single biggest reframe on this page: Stitch's premise is a fully
// "automated," "on autopilot" dispatch engine. That's not what exists —
// EXPO_PUBLIC_AUTOMATION_ENABLED is false in mobile/eas.json, and the
// real reminders.service.ts flow is business-triggered (bulkSendReminders
// is an explicit action a business takes; Chakusa never sends on its
// own). Every "automatic"/"autopilot" framing below is replaced with
// "surfaced for review" / "sent when you choose to," matching the
// homepage lifecycle's existing "Retain" step and its "never automatic"
// sending policy.
//
// Fabricated content from the Stitch source removed, not replaced with
// different fabricated content:
// - "84.2% Auto-Rebook / 0 Hrs Manual Calls / 18 Mo Avg Client
//   Lifetime" — specific, unverifiable, and inconsistent with a
//   business-triggered (not autonomous) send flow. Replaced with the
//   real facts (what triggers a reminder, who sends it, what it's built
//   from).
// - The "SMS Dispatch Simulation" with named customers (Marcus Ray,
//   Elena Rostova, Samuel Ward) and specific dates/prices, plus a
//   "Zero Spam Filter Hits" claim — fabricated. Replaced with one
//   clearly-labeled illustrative reminder example.
// - Per-industry "Dispatched Tone" quotes with invented re-engagement
//   percentages (92%, 76%, 66%, 94%, 81%, 73%) — replaced with honest,
//   generic per-trade cadence descriptions (no invented conversion
//   numbers).
// - The "Mayo Lin" testimonial with photo and "+38% Annual Client LTV"
//   — a fabricated identity and outcome. Removed, not replaced with a
//   different fabricated one.
// - "Configure in under five minutes" and "Pre-Calibrated Trade
//   Presets" — unverifiable setup-time claim and an unconfirmed preset
//   library; removed.
export const retentionHero = {
  badge: "Bring customers back, on purpose",
  title: "Know who's due for a rebook, before they quietly stop coming back.",
  body: "Chakusa watches the gap since a customer's last visit and surfaces the ones who are overdue, so a reminder goes out when you choose to send it, not months after they've moved on.",
};

export const retentionProof = [
  { label: "What triggers it", value: "The rebooking window" },
  { label: "Who sends it", value: "You do" },
  { label: "Message source", value: "Your own templates" },
];

export interface RetentionStep { number: string; icon: string; title: string; body: string; tag: string }
export const retentionSteps: RetentionStep[] = [
  { number: "01", icon: "check", title: "Service delivered", body: "A visit is completed and logged against the customer's profile.", tag: "Business-logged" },
  { number: "02", icon: "clock", title: "Time passes", body: "Chakusa tracks the gap since that customer's last visit.", tag: "Ongoing" },
  { number: "03", icon: "flag", title: "Window identified", body: "When the gap crosses the expected rebooking window, the customer is flagged as due.", tag: "Surfaced, not sent" },
  { number: "04", icon: "note", title: "Reminder prepared", body: "A message is drafted from your own reminder template, ready to review.", tag: "Never automatic" },
  { number: "05", icon: "send", title: "You send it", body: "You choose when to send, one at a time or in bulk, from your dashboard.", tag: "Owner-controlled" },
];

export const reminderExample = {
  label: "Illustrative example",
  note: "Not a real customer — shown to demonstrate the reminder format.",
  customer: "A customer",
  lastVisit: "6 weeks ago",
  message: "Hi, it's been a little while since your last visit. Want to grab a spot this week?",
};

export interface RetentionIndustry { icon: string; title: string; cadence: string; body: string }
export const retentionIndustries: RetentionIndustry[] = [
  { icon: "cut", title: "Barbers & Salons", cadence: "Every 3–4 weeks", body: "Rebooking windows track how often chair appointments are typically due." },
  { icon: "health", title: "Dentists & Hygienists", cadence: "Every 6 months", body: "Longer windows suit recall-based, not weekly, scheduling." },
  { icon: "car", title: "Auto & Independent Garages", cadence: "Mileage or seasonal", body: "Reminders can track service intervals instead of pure elapsed time." },
  { icon: "clean", title: "Residential Cleaners", cadence: "Weekly or bi-weekly", body: "Recurring visit cadences make overdue customers easy to spot." },
  { icon: "camera", title: "Portrait Photographers", cadence: "Annual or seasonal", body: "Longer, occasion-based windows fit infrequent bookings." },
  { icon: "home", title: "HVAC & Home Systems", cadence: "Seasonal", body: "Pre-season maintenance windows instead of a fixed weekly cadence." },
];

export const retentionCta = {
  label: "Keep your calendar full, on your terms",
  title: "Turn on rebooking reminders for customers who go quiet.",
  body: "Set your own rebooking windows and templates, then decide when reminders go out.",
};
