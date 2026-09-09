import { config } from "./config.js";

// Shares the customer web origin with review/quote/invoice links
// (PUBLIC_REVIEW_BASE_URL). Production requires it (see config.ts); this
// dev fallback only fires locally/in tests.
const DEV_DEFAULT_BASE_URL = "http://localhost:19006";

export interface PublicBookingLinkOptions {
  serviceOfferingId?: string;
  /** One of public.schemas.ts BOOKING_SOURCES — appended as ?src= for attribution. */
  source?: string;
}

/**
 * The one place the customer-facing booking-link shape (`<base>/book/<slug>`)
 * is assembled, so every distribution surface (owner share sheet, QR, embed,
 * campaign) stays consistent with whatever path the public frontend serves.
 * A `?service=` deep-links straight to one service; `?src=` is picked up by
 * the public booking POST for privacy-safe attribution.
 */
export function buildPublicBookingUrl(slug: string, options: PublicBookingLinkOptions = {}): string {
  const base = (config.PUBLIC_REVIEW_BASE_URL ?? DEV_DEFAULT_BASE_URL).replace(/\/+$/, "");
  const params = new URLSearchParams();
  if (options.serviceOfferingId) params.set("service", options.serviceOfferingId);
  if (options.source) params.set("src", options.source);
  const query = params.toString();
  return `${base}/book/${slug}${query ? `?${query}` : ""}`;
}

export function publicBookingBaseConfigured(): boolean {
  return Boolean(config.PUBLIC_REVIEW_BASE_URL);
}
