import { config } from "../../lib/config.js";

// Same fallback rationale as publicReviewLinks.ts's
// DEV_DEFAULT_PUBLIC_REVIEW_BASE_URL — only ever used in local dev/test.
const DEV_DEFAULT_PUBLIC_BASE_URL = "http://localhost:19006";

/**
 * Builds the invitee-facing URL for a raw team-invitation token. Reuses
 * config.ts's PUBLIC_REVIEW_BASE_URL rather than introducing a second
 * "public web base URL" config value — it's the same public web frontend
 * domain either way, just a different path (`/team-invite/<token>` vs
 * `/r/<token>`), and this backend has no reason to assume the public
 * frontend for reviews and team invites are different deployments.
 */
export function buildTeamInviteUrl(rawToken: string): string {
  const base = (config.PUBLIC_REVIEW_BASE_URL ?? DEV_DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, "");
  return `${base}/team-invite/${rawToken}`;
}
