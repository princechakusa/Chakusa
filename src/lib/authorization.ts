// Business-scoped authorization. `request.role` is resolved once per request
// by tenant.ts's requireBusiness from the caller's BusinessMember row (the
// same trusted server-side pattern as request.businessId/plan/status) — never
// trust a role the client claims.
//
// Advanced Team #12: the single role -> capability matrix and the
// requireCapability route gate live in ./capabilities.ts. Route handlers ask
// "may this member do X" (requireCapability), never "what role is this
// member". Authorization is a separate axis from entitlement
// (entitlements.ts, "does this plan include this feature"); both must pass.
export { can, requireCapability, CAPABILITIES } from "./capabilities.js";
export type { Capability } from "./capabilities.js";
