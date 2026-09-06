import { config } from "../config.js";

// PROGRAM 3 / Invoicing I4: the ONE place the customer-facing invoice URL
// shape (`<base>/i/<rawToken>`) is assembled - mirrors publicQuoteLinks.
// Base resolution: PUBLIC_INVOICE_BASE_URL -> PUBLIC_REVIEW_BASE_URL (the
// shared, production-required customer web origin) -> a local dev
// placeholder. Production config guarantees at least one real https base,
// so this never emits a fake-looking domain to a customer.
const DEV_DEFAULT_PUBLIC_INVOICE_BASE_URL = "http://localhost:19006";

export function buildPublicInvoiceUrl(rawToken: string): string {
  const base = (config.PUBLIC_INVOICE_BASE_URL ?? config.PUBLIC_REVIEW_BASE_URL ?? DEV_DEFAULT_PUBLIC_INVOICE_BASE_URL).replace(/\/+$/, "");
  return `${base}/i/${rawToken}`;
}
