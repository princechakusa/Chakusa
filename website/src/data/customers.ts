// PROGRAM: CHAKUSA WEBSITE FRONTEND MIGRATION - Customers feature page.
// Structure reproduced from the Stitch export
// (chakusa_customers_practical_client_crm_for_artisans/code.html): hero
// + proof strip, one illustrative customer-profile spotlight, a
// 4-feature capability grid, industry adaptations, final CTA.
//
// Grounded against prisma/schema.prisma's Customer/CustomerTag models
// and src/modules/customers/ (customerCsv.ts, audiences.service.ts):
// name/phone/email/notes/birthday/anniversary/customFields, tags,
// CSV import (name/phone/email/notes columns) and CSV export are real.
//
// Fabricated content from the Stitch source removed, not replaced with
// different fabricated content:
// - "94.2% Recall Accuracy / <3 Sec Formula Retrievability / -38%
//   No-Show / 0% Data Lock-In" - specific, unverifiable numbers.
//   Replaced with the real facts (what's on a profile, how it's
//   exported, that it's never locked in).
// - The named client profile ("Marcus Vance", $2,940 lifetime spend,
//   25 visits, allergy notes, service formulas) and the "Julian Vance"
//   testimonial with photo - fabricated identities. Replaced with one
//   clearly-labeled illustrative profile, no invented name or photo.
// - Per-industry fabricated schema fields (VIN numbers, allergy
//   flags, "formula cards") presented as built-in dedicated fields -
//   the real product stores this as flexible notes/custom fields, not
//   named per-industry columns; described that way instead.
// - "Import instantly from iOS, Google Contacts, and Square" - no such
//   integration exists; the real import path is a CSV upload.
// - "Free 30-Day Business Trial" - no trial exists; real plans are
//   Free / Pro / Business.
export const customersHero = {
  badge: "One record per customer",
  title: "Every visit adds to the same customer record.",
  body: "Name, contact details, notes, and visit history stay together on one profile, so the next conversation starts with context instead of a blank slate.",
};

export const customersProof = [
  { label: "On every profile", value: "Contact, notes, history" },
  { label: "Export format", value: "CSV, anytime" },
  { label: "Data lock-in", value: "None" },
];

export const profileSpotlight = {
  label: "Illustrative example",
  note: "Not a real customer - shown to demonstrate the profile format.",
  name: "Example customer",
  meta: "Member since example date",
  tags: ["Regular", "Prefers SMS"],
  notes: "Prefers the 3pm slot. Allergic to a specific product ingredient (noted for staff).",
  visits: [
    { service: "Standard service visit", date: "3 weeks ago", status: "Completed" },
    { service: "Follow-up visit", date: "9 weeks ago", status: "Completed" },
    { service: "First visit", date: "4 months ago", status: "Completed" },
  ],
};

export interface CustomerCapability { icon: string; title: string; body: string }
export const customerCapabilities: CustomerCapability[] = [
  { icon: "search", title: "Search and filters", body: "Find any customer by name, phone, tag, or how long it's been since their last visit." },
  { icon: "note", title: "Notes on every profile", body: "Keep the preferences, product notes, and history that make repeat visits feel personal." },
  { icon: "message", title: "Message history in context", body: "See enquiries, bookings, and messages tied to a customer without leaving their profile." },
  { icon: "csvexport", title: "You own the data", body: "Import from a CSV, export to a CSV, anytime. Nothing is locked behind the platform." },
];

export interface CustomerIndustry { icon: string; title: string; body: string }
export const customerIndustries: CustomerIndustry[] = [
  { icon: "cut", title: "Barbers & Salons", body: "Track preferences and notes per client, and see who's due for a rebook." },
  { icon: "car", title: "Auto & Trades", body: "Keep job notes and history attached to each customer's record." },
  { icon: "health", title: "Health & Wellness", body: "Store the notes that matter for each client's next appointment." },
  { icon: "clean", title: "Home & Cleaning", body: "Keep recurring-customer preferences and access notes in one place." },
];

export const customersCta = {
  label: "Stop losing client context",
  title: "Move client history out of notebooks and group chats.",
  body: "Import your existing customer list from a CSV and start building real profiles from the next visit on.",
};
