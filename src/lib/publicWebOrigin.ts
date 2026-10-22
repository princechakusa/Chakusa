import { config } from "./config.js";

// The one origin every customer-facing link is built on (shop pages /b/,
// booking, reviews /r/, quotes /q/, invoices /i/, team invites, referrals).
// In production it is the admin console's "Website" setting (app.website_url),
// loaded at boot and refreshed when an admin saves it, so a wrong value is
// fixed from the console instead of a redeploy. Until that is loaded (local
// dev, tests, a failed boot read) it falls back to PUBLIC_REVIEW_BASE_URL.

let adminWebsiteUrl: string | null = null;

export function setPublicWebOrigin(url: string | null | undefined): void {
  const trimmed = url?.trim().replace(/\/+$/, "");
  adminWebsiteUrl = trimmed && /^https:\/\//.test(trimmed) ? trimmed : null;
}

/** The public web origin without a trailing slash, or undefined when none is configured. */
export function publicWebOrigin(): string | undefined {
  return adminWebsiteUrl ?? config.PUBLIC_REVIEW_BASE_URL?.replace(/\/+$/, "");
}
