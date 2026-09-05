import { config } from "../config.js";

// PROGRAM 3 LOOP 3G: the ONE place the customer-facing quote URL shape
// (`<base>/q/<rawToken>`) is assembled - every caller (the send / revise /
// resend responses today, provider-channel delivery later) stays
// consistent with whatever path the customer web app actually serves.
//
// Base resolution, in order: PUBLIC_QUOTE_BASE_URL (set only if the quote
// page lives on a different host), then PUBLIC_REVIEW_BASE_URL (the shared
// customer web origin, already production-required), then a clearly-local
// dev placeholder. Production config validation guarantees at least one
// real https base, so this never emits a fake-looking domain into a
// customer-facing surface.
const DEV_DEFAULT_PUBLIC_QUOTE_BASE_URL = "http://localhost:19006";

export function buildPublicQuoteUrl(rawToken: string): string {
  const base = (config.PUBLIC_QUOTE_BASE_URL ?? config.PUBLIC_REVIEW_BASE_URL ?? DEV_DEFAULT_PUBLIC_QUOTE_BASE_URL).replace(/\/+$/, "");
  return `${base}/q/${rawToken}`;
}
