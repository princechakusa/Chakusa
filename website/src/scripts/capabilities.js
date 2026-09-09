// #22 — a UX-only mirror of the backend role -> capability matrix
// (src/lib/capabilities.ts). The gateway and the Fastify API remain the
// sole authority: this only decides whether to *show* an action, never
// whether it is *allowed*. Keep in sync with the backend; guarded against
// drift by cloudflare/auth-gateway/../.. and tests/web-capabilities.test.mjs.

// ADMIN: operational manager. No ownership, billing, business-settings,
// commission-rule or data-export authority.
const ADMIN = new Set([
  "team.view", "catalog.manage", "availability.manage", "leads.manage",
  "customers.manage", "appointments.manage", "appointments.operate", "reviews.manage",
  "messaging.operate", "messaging.config.manage", "automation.manage", "loyalty.manage",
  "quotes.manage", "quotes.cancel", "invoices.manage", "invoices.void", "payments.view",
  "financial.operate", "financial.report.view", "commissions.report.view",
  "integrations.manage", "inventory.view", "inventory.record", "inventory.adjust",
  "inventory.manage",
]);

// STAFF: operational worker. Booking, serving customers/leads, recording
// spend, quote/invoice actions, stock in/out. No team/roles/billing/settings,
// business-wide financial or commission reporting, or configuration.
const STAFF = new Set([
  "team.view", "leads.manage", "customers.manage", "appointments.manage",
  "appointments.operate", "reviews.manage", "messaging.operate", "quotes.manage",
  "invoices.manage", "financial.operate", "inventory.view", "inventory.record",
]);

/** UX-only predicate. OWNER holds every capability. */
export function can(role, capability) {
  if (role === "OWNER") return true;
  if (role === "ADMIN") return ADMIN.has(capability);
  if (role === "STAFF") return STAFF.has(capability);
  return false;
}
