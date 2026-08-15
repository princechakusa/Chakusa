import type { FastifyRequest } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { ApiError } from "./errors.js";

/**
 * Centralized, minimal role authorization — see the Business Phase 1
 * report's "central authorization architecture" section for why this
 * exists: scattered `if (request.role === "OWNER")` checks across route
 * files are easy to get subtly wrong or forget entirely, especially for
 * destructive/billing actions. `request.role` is resolved once per request
 * by tenant.ts's requireBusiness (the same trusted-server-side pattern as
 * request.businessId/plan/status) — never trust a role the client claims.
 *
 * Deliberately small: v1 has exactly one real distinction that matters for
 * authorization (OWNER vs everyone else) — see requireOwner below. A
 * generic requireBusinessRole is exported too for the one or two call
 * sites that need to allow more than one role, but resist inventing a
 * permission matrix beyond what's actually enforced today.
 */
export function requireBusinessRole(request: FastifyRequest, allowed: readonly BusinessRole[]): void {
  if (!request.role || !allowed.includes(request.role)) {
    throw ApiError.forbidden("You do not have permission to perform this action");
  }
}

/**
 * Owner-only gate — applied to billing/subscription verification, team
 * invitations, member role changes, and member removal (see the Business
 * Phase 1 report's "role model" and "billing authorization" sections for
 * why each of those is owner-only in v1, not ADMIN-eligible).
 */
export function requireOwner(request: FastifyRequest): void {
  requireBusinessRole(request, ["OWNER"]);
}
