// Pure helpers for the web quote/invoice editor (SalesDocument.astro).
//
// Validation here is for usability only: the backend re-validates every field
// (src/modules/quotes/quotes.schemas.ts, src/modules/invoices/invoices.schemas.ts)
// and computes every total. tests/web-sales-documents.test.ts proves the
// payloads built here are accepted by those backend schemas unchanged.

// Matches the auth gateway's request body cap (cloudflare/auth-gateway MAX_BODY_BYTES).
export const MAX_BODY_BYTES = 32_768;
export const MAX_LINES = 40;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AMOUNT = /^\d{1,8}(\.\d{1,2})?$/;
const QUANTITY = /^\d{1,6}(\.\d{1,2})?$/;
const RATE = /^\d{1,3}(\.\d{1,3})?$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Only an absolute https URL is ever shown to the user as a customer link. */
export function safeHttpsUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

const trimmed = (value) => (typeof value === "string" ? value.trim() : "");

/** Returns a user-facing problem, or null when the form can be sent. */
export function validateDocumentForm(kind, fields) {
  const lines = Array.isArray(fields.lines) ? fields.lines : [];
  if (kind === "quote" && fields.documentType && !["QUOTE", "ESTIMATE"].includes(fields.documentType)) return "Choose quote or estimate.";
  if (trimmed(fields.customerId) && !isUuid(trimmed(fields.customerId))) return "Choose a customer from the list.";
  if (!lines.length) return "Add at least one line item.";
  if (lines.length > MAX_LINES) return `A web document can have up to ${MAX_LINES} line items.`;
  for (const [index, line] of lines.entries()) {
    const n = index + 1;
    const description = trimmed(line.description);
    if (!description) return `Line ${n}: add a description.`;
    if (description.length > 500) return `Line ${n}: the description is too long (500 characters max).`;
    const quantity = trimmed(line.quantity);
    if (!QUANTITY.test(quantity) || Number(quantity) <= 0) return `Line ${n}: quantity must be a number above 0 (up to 2 decimals).`;
    const unitPrice = trimmed(line.unitPrice);
    if (!AMOUNT.test(unitPrice)) return `Line ${n}: unit price must be an amount like 25 or 25.50.`;
    const discount = trimmed(line.discountAmount);
    if (discount && !AMOUNT.test(discount)) return `Line ${n}: discount must be an amount like 5 or 5.00.`;
    if (discount && Number(discount) > Number(quantity) * Number(unitPrice)) return `Line ${n}: the discount is larger than the line amount.`;
  }
  const rate = trimmed(fields.taxRatePercent);
  if (rate && (!RATE.test(rate) || Number(rate) > 100)) return "Tax rate must be between 0 and 100.";
  if (trimmed(fields.notes).length > 5000) return "Notes are too long (5,000 characters max).";
  if (trimmed(fields.terms).length > 5000) return "Terms are too long (5,000 characters max).";
  for (const key of kind === "quote" ? ["expiresAt"] : ["issueDate", "dueDate"]) {
    const value = trimmed(fields[key]);
    if (value && (!DAY.test(value) || Number.isNaN(Date.parse(value)))) return "Enter dates using the date picker.";
  }
  if (kind === "invoice" && trimmed(fields.issueDate) && trimmed(fields.dueDate) && trimmed(fields.dueDate) < trimmed(fields.issueDate)) return "The due date cannot be before the issue date.";
  return null;
}

/**
 * Builds the exact request body for create / update (draft edit or quote
 * revise). The backend treats an update as a full replacement, so every
 * field is always sent: an empty value clears it on purpose, and existing
 * origin links (lead, appointment, customer profile) are carried forward
 * so a web edit never silently detaches them.
 */
export function buildDocumentPayload(kind, operation, fields, expectedCurrentRevisionId, origins = {}) {
  const optional = (value) => (trimmed(value) ? trimmed(value) : null);
  const lineItems = fields.lines.map((line, index) => {
    const item = {
      description: trimmed(line.description),
      quantity: trimmed(line.quantity),
      unitPrice: trimmed(line.unitPrice),
      discountAmount: trimmed(line.discountAmount) || "0",
      taxable: line.taxable !== false,
      sortOrder: index,
    };
    if (isUuid(line.serviceOfferingId)) item.serviceOfferingId = line.serviceOfferingId;
    return item;
  });
  const customerId = isUuid(trimmed(fields.customerId)) ? trimmed(fields.customerId) : null;
  const payload = {
    customerId,
    lineItems,
    notes: optional(fields.notes),
    terms: optional(fields.terms),
    taxRatePercent: trimmed(fields.taxRatePercent) || "0",
  };
  if (isUuid(origins.appointmentId)) payload.appointmentId = origins.appointmentId;
  // A customer profile belongs to one customer: keep it only while the
  // customer is unchanged.
  if (isUuid(origins.customerProfileId) && customerId && customerId === origins.customerId) payload.customerProfileId = origins.customerProfileId;
  if (kind === "quote") {
    payload.expiresAt = optional(fields.expiresAt);
    if (isUuid(origins.leadId)) payload.leadId = origins.leadId;
    if (operation === "create") payload.documentType = fields.documentType === "ESTIMATE" ? "ESTIMATE" : "QUOTE";
  } else {
    payload.issueDate = optional(fields.issueDate);
    payload.dueDate = optional(fields.dueDate);
  }
  if (operation !== "create") payload.expectedCurrentRevisionId = expectedCurrentRevisionId;
  return payload;
}

/**
 * The backend stores the tax amount, not the rate. When editing an existing
 * draft, work the rate back out so a save does not silently drop the tax.
 * Returns "" when there is no tax, otherwise a rate rounded to 3 decimals.
 */
export function deriveTaxRatePercent(revision) {
  const taxTotal = Number(revision?.totals?.taxTotal ?? 0);
  if (!Number.isFinite(taxTotal) || taxTotal <= 0) return "";
  const taxableBase = (revision?.lineItems ?? []).filter((line) => line.taxable).reduce((sum, line) => sum + Number(line.lineTotal || 0), 0);
  if (!(taxableBase > 0)) return "";
  const rate = Math.min(100, (taxTotal / taxableBase) * 100);
  return String(Math.round(rate * 1000) / 1000);
}
