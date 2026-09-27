// How it works (Stitch layout) content.
//
// 2026-09 truth pass: the original Stitch import shipped fabricated claims
// (conversion/LTV/no-show percentages, rating counts, loyalty "Guild
// points", wallet passes, cryptographic review verification, automatic
// missed-call texting, autonomous retention). All replaced with behaviour
// verified against the repository and the ledgers in data/how-it-works.ts
// and data/enquiries.ts:
// - Automated sending is off in shipped builds (mobile/eas.json
//   EXPO_PUBLIC_AUTOMATION_ENABLED=false); lead replies are prepared from
//   templates and sent by a person (Copy / Open SMS / Open WhatsApp).
// - Missed calls become leads automatically on Android only (Recovery
//   Engine permission); public-profile messages always do.
// - Booking confirmations and appointment reminders are real server-sent
//   SMS (src/modules/appointments/appointmentReminders.ts), plan-gated and
//   opt-out aware.
// - Review requests are ungated; comeback reminders surface customers who
//   haven't rebooked in their usual window.
// Demo names in `detail` fields are illustrative, and labelled as such.

export interface JourneyStepData { number: string; label: string; icon: string; title: string; body: string; detail: string; meta: string; touchpoint?: boolean }

export const customerJourney: JourneyStepData[] = [
  { number:"01", label:"Discover", icon:"explore", title:"Find a local business", body:"A public Chakusa business profile and marketplace listing show the services, the business, and its reviews before any conversation starts.", detail:"Northside Barbers", meta:"Public profile · Services · Reviews" },
  { number:"02", label:"Ask", icon:"forum", title:"Send an enquiry, or just call", body:"Message the business through its public profile, or phone as usual. Either way the business has a record to follow up on.", detail:"“Any time Thursday for a skin fade?”", meta:"Sent from the public profile" },
  { number:"03", label:"Hear back", icon:"inbox", title:"Get a real reply from the business", body:"The reply comes from a person at the business, prepared from their own template and sent by them over SMS or WhatsApp.", detail:"“We have Thursday 10:30 free. Want it?”", meta:"Sent by the business" },
  { number:"04", label:"Book", icon:"calendar_month", title:"Confirm a time that is actually free", body:"The appointment is made against the business's real services and availability, and a booking confirmation follows by SMS.", detail:"Thu 14 · 10:30 · Skin fade", meta:"Confirmation by SMS", touchpoint:true },
  { number:"05", label:"Visit", icon:"event_available", title:"Get a reminder, then show up", body:"A reminder arrives ahead of the appointment, so the visit isn't forgotten. The service itself is the business's craft, not the app's.", detail:"“Reminder: your appointment is tomorrow at 10:30.”", meta:"Reminder by SMS" },
  { number:"06", label:"Review", icon:"star_rate", title:"Asked for honest feedback", body:"After the visit the customer is asked for a review, whatever the business expects them to say. Nobody is filtered out.", detail:"How was your visit?", meta:"Every visit, never gated", touchpoint:true },
  { number:"07", label:"Return", icon:"repeat", title:"A nudge when it's time again", body:"When the usual gap since the last visit has passed, the business can send a friendly reminder to come back.", detail:"“Ready for a fresh cut?”", meta:"Sent when the business chooses", touchpoint:true },
];

export const businessJourney: JourneyStepData[] = [
  { number:"01", label:"Set up", icon:"tune", title:"Profile, services, team, templates", body:"Set up the business once. Chakusa uses it for the public profile, bookings, and every message you prepare later.", detail:"Services · Team · Templates", meta:"One-time setup" },
  { number:"02", label:"Capture", icon:"contact_phone", title:"The enquiry lands as a lead", body:"Public-profile messages become leads automatically. On Android, so do missed calls. Anything else is a few taps to add.", detail:"New lead · Jordan M.", meta:"Stays visible until you act" },
  { number:"03", label:"Reply", icon:"forum", title:"Prepare the message, then send it", body:"Prepare message fills your template with the customer's name and service. You choose Copy, Open SMS, or Open WhatsApp.", detail:"Draft ready from your template", meta:"Never sent automatically" },
  { number:"04", label:"Schedule", icon:"calendar_month", title:"The booking lands in your calendar", body:"Services, availability, and the team calendar come together, and the customer's confirmation goes out.", detail:"Thu 14 · 10:30 · Jordan M.", meta:"Calendar · Confirmation", touchpoint:true },
  { number:"05", label:"Serve", icon:"shield", title:"Do the work with context", body:"The customer's history, notes, and previous visits are on one profile, so the conversation starts where it left off.", detail:"3 past visits · Notes", meta:"One customer profile" },
  { number:"06", label:"Reviews", icon:"star_rate", title:"Request a review for every visit", body:"Review requests go to every eligible customer, never withheld based on how the visit is expected to go.", detail:"Review request sent", meta:"Ungated", touchpoint:true },
  { number:"07", label:"Comeback", icon:"repeat", title:"See who is due back", body:"Chakusa surfaces customers who haven't rebooked in their usual window, so you can reach out before they drift away.", detail:"Jordan M. · Due back", meta:"You decide when to send", touchpoint:true },
];

export const touchpoints = [
  { number:"01", icon:"event_available", title:"The booking", body:"The customer's chosen time becomes an appointment in the business calendar, and a confirmation goes to the customer.", meta:"Calendar + SMS confirmation" },
  { number:"02", icon:"storefront", title:"The visit", body:"A reminder goes out ahead of the appointment; the business sees the customer's history when they arrive.", meta:"Reminder + customer profile" },
  { number:"03", icon:"star_rate", title:"The feedback", body:"Every completed visit can get a review request, with no filtering by expected rating.", meta:"Ungated review requests" },
  { number:"04", icon:"repeat", title:"The return", body:"Customers past their usual rebooking window are flagged, and the business chooses when to reach out.", meta:"Comeback reminders" },
];

export const tradeStories = [
  { image:"/images/how-it-works/trades/barber.jpg", alt:"A barber trimming a beard in a studio", title:"Barbers & grooming", body:"Regulars on a few-week cycle, walk-in enquiries during a cut, and reviews while the fade is fresh.", setup:"Beauty" },
  { image:"/images/how-it-works/trades/mechanic.jpg", alt:"An auto technician reviewing diagnostics in a workshop", title:"Mechanics & auto", body:"Repair enquiries while the workshop is mid-job, bookings by service, and reminders when the next service is due.", setup:"Automotive" },
  { image:"/images/how-it-works/trades/photographer.jpg", alt:"A photographer preparing camera equipment", title:"Photographers & studios", body:"Shoot enquiries captured as leads, confirmed sessions, and a public profile clients can find.", setup:"Professional" },
];

// Same verified answers as data/how-it-works.ts's howItWorksFaqs.
export { howItWorksFaqs as stitchHowFaqs } from "./how-it-works";
