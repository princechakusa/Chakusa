import { config } from "./config.js";

// Only used when PUBLIC_REVIEW_BASE_URL is unset — production requires the
// real env var (see config.ts), so this only ever fires in local dev/test,
// where it lets the review-message flow work without any setup.
const DEV_DEFAULT_PUBLIC_REVIEW_BASE_URL = "http://localhost:19006";

/**
 * Builds the customer-facing URL for a raw public review/feedback token —
 * the one and only place this shape (`<base>/r/<token>`) is assembled, so
 * every caller (review-message generation today, anything else later) stays
 * consistent with whatever path the public frontend is actually built at.
 */
export function buildPublicReviewUrl(rawToken: string): string {
  const base = (config.PUBLIC_REVIEW_BASE_URL ?? DEV_DEFAULT_PUBLIC_REVIEW_BASE_URL).replace(/\/+$/, "");
  return `${base}/r/${rawToken}`;
}
