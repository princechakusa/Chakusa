import type { BusinessRole } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { ApiError } from "./errors.js";

/**
 * Advanced Team #12 — the single, authoritative role -> capability matrix.
 *
 * WHY a capability layer and not more `request.role === "OWNER"` checks:
 * route handlers must ask "may this member do X", never "what role is this
 * member" — the mapping from role to what-they-may-do lives here and nowhere
 * else, so the matrix can be audited in one place and a new endpoint cannot
 * silently disagree with a sibling endpoint about who is allowed.
 *
 * This is deliberately NOT a configurable RBAC system: the three roles
 * (OWNER / ADMIN / STAFF) are fixed, there are no custom roles and no
 * per-member capability overrides. `request.role` is resolved server-side by
 * tenant.ts's requireBusiness from the caller's BusinessMember row — never
 * from anything the client sends.
 *
 * Authorization ("may this member perform this action") is a separate axis
 * from entitlement ("does this business's plan include this feature",
 * entitlements.ts). Both must pass. Never fold one into the other.
 */
export const CAPABILITIES = [
  // Business-level controls — OWNER only.
  "business.settings.manage",
  "business.subscription.manage",
  "business.data.export",
  "business.calendarFeed.manage",
  "payments.manage",
  // Team.
  "team.view",
  "team.members.manage",
  "team.roles.manage",
  "team.ownership.transfer",
  // Catalogue and scheduling.
  "catalog.manage",
  "availability.manage",
  // Operational modules.
  "leads.manage",
  "customers.manage",
  "appointments.manage",
  "appointments.operate",
  "reviews.manage",
  "messaging.operate",
  "messaging.config.manage",
  "messaging.credentials.manage",
  "automation.manage",
  "loyalty.manage",
  // Commercial documents.
  "quotes.manage",
  "quotes.cancel",
  "invoices.manage",
  "invoices.void",
  "payments.view",
  // Financial and compensation.
  "financial.operate",
  "financial.config.manage",
  "financial.report.view",
  "commissions.report.view",
  "commissions.rules.manage",
  "integrations.manage",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const ALL = new Set<Capability>(CAPABILITIES);

// OWNER: full business authority.
const OWNER: ReadonlySet<Capability> = ALL;

// ADMIN: operational manager. No ownership, billing, business-settings,
// commission-rule, or business-data-export authority, and cannot change the
// controls that would let it elevate itself.
const ADMIN: ReadonlySet<Capability> = new Set<Capability>([
  "team.view",
  "catalog.manage",
  "availability.manage",
  "leads.manage",
  "customers.manage",
  "appointments.manage",
  "appointments.operate",
  "reviews.manage",
  "messaging.operate",
  "messaging.config.manage",
  "automation.manage",
  "loyalty.manage",
  "quotes.manage",
  "quotes.cancel",
  "invoices.manage",
  "invoices.void",
  "payments.view",
  "financial.operate",
  "financial.report.view",
  "commissions.report.view",
  "integrations.manage",
]);

// STAFF: operational worker. Everything here preserves an access that
// existing workflows already grant STAFF (booking, serving customers/leads,
// recording spend, quote/invoice actions). No team, roles, billing,
// settings, business-wide financial/commission reporting, or configuration.
const STAFF: ReadonlySet<Capability> = new Set<Capability>([
  "team.view",
  "leads.manage",
  "customers.manage",
  "appointments.manage",
  "appointments.operate",
  "reviews.manage",
  "messaging.operate",
  "quotes.manage",
  "invoices.manage",
  "financial.operate",
]);

const ROLE_CAPABILITIES: Record<BusinessRole, ReadonlySet<Capability>> = { OWNER, ADMIN, STAFF };

/** Pure predicate — safe to use for response shaping / UX hints as well as gates. */
export function can(role: BusinessRole | undefined | null, capability: Capability): boolean {
  return !!role && ROLE_CAPABILITIES[role].has(capability);
}

/**
 * Route gate. Throws 403 unless the caller's server-resolved role holds the
 * capability. Call after fastify.requireBusiness (which sets request.role).
 */
export function requireCapability(request: FastifyRequest, capability: Capability): void {
  if (!can(request.role, capability)) {
    throw ApiError.forbidden("You do not have permission to perform this action");
  }
}
