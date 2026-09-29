import { describe, expect, it } from "vitest";
import { createQuoteSchema, updateQuoteSchema } from "../src/modules/quotes/quotes.schemas.js";
import { createInvoiceSchema, updateInvoiceSchema } from "../src/modules/invoices/invoices.schemas.js";
// The website's quote/invoice editor helpers (usability only — the backend
// re-validates and computes every total). These tests prove the web never
// builds a body the backend would reject, and never drops data on edit.
import { buildDocumentPayload, validateDocumentForm, deriveTaxRatePercent, safeHttpsUrl, isUuid, MAX_BODY_BYTES, MAX_LINES } from "../website/src/scripts/salesDocuments.js";

const CUSTOMER = "11111111-2222-4333-8444-555555555555";
const OTHER_CUSTOMER = "22222222-3333-4444-8555-666666666666";
const REVISION = "33333333-4444-4555-8666-777777777777";
const LEAD = "44444444-5555-4666-8777-888888888888";
const APPOINTMENT = "55555555-6666-4777-8888-999999999999";
const PROFILE = "66666666-7777-4888-8999-aaaaaaaaaaaa";

const line = (overrides = {}) => ({ description: "Deep clean", quantity: "2", unitPrice: "45.50", discountAmount: "", taxable: true, ...overrides });
const fields = (overrides = {}) => ({ documentType: "QUOTE", customerId: CUSTOMER, taxRatePercent: "", notes: "", terms: "", expiresAt: "", issueDate: "", dueDate: "", lines: [line()], ...overrides });

describe("web sales-document payloads are accepted by the backend schemas", () => {
  it("quote create", () => {
    const payload = buildDocumentPayload("quote", "create", fields({ expiresAt: "2026-12-31", notes: "Thanks!" }));
    const parsed = createQuoteSchema.parse(payload);
    expect(parsed.documentType).toBe("QUOTE");
    expect(parsed.lineItems).toHaveLength(1);
    expect(payload).not.toHaveProperty("expectedCurrentRevisionId");
  });

  it("estimate create keeps its type; any other value falls back to QUOTE", () => {
    expect(createQuoteSchema.parse(buildDocumentPayload("quote", "create", fields({ documentType: "ESTIMATE" }))).documentType).toBe("ESTIMATE");
    expect(createQuoteSchema.parse(buildDocumentPayload("quote", "create", fields({ documentType: "INVOICE" }))).documentType).toBe("QUOTE");
  });

  it("quote update / revise carries the concurrency guard and never sends documentType", () => {
    const payload = buildDocumentPayload("quote", "update", fields(), REVISION);
    expect(updateQuoteSchema.parse(payload).expectedCurrentRevisionId).toBe(REVISION);
    expect(payload).not.toHaveProperty("documentType");
  });

  it("invoice create and update", () => {
    const create = buildDocumentPayload("invoice", "create", fields({ issueDate: "2026-10-01", dueDate: "2026-10-15" }));
    expect(createInvoiceSchema.parse(create).lineItems).toHaveLength(1);
    expect(create).not.toHaveProperty("leadId");
    expect(create).not.toHaveProperty("expiresAt");
    expect(updateInvoiceSchema.parse(buildDocumentPayload("invoice", "update", fields(), REVISION)).expectedCurrentRevisionId).toBe(REVISION);
  });

  it("never sends server-owned values (totals, currency, numbers, status, business)", () => {
    const payload = buildDocumentPayload("invoice", "update", fields(), REVISION);
    for (const key of ["businessId", "currency", "invoiceNumber", "documentNumber", "status", "total", "subtotal", "taxTotal", "createdByMemberId"]) expect(payload).not.toHaveProperty(key);
    for (const item of payload.lineItems as Record<string, unknown>[]) expect(item).not.toHaveProperty("lineTotal");
  });

  it("a maximum-size web document still fits the gateway body cap", () => {
    const long = "x".repeat(500);
    const payload = buildDocumentPayload("quote", "update", fields({ notes: "n".repeat(1000), terms: "t".repeat(1000), lines: Array.from({ length: MAX_LINES }, () => line({ description: long })) }), REVISION);
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeLessThan(MAX_BODY_BYTES);
    expect(updateQuoteSchema.parse(payload).lineItems).toHaveLength(MAX_LINES);
  });
});

describe("editing never silently drops data", () => {
  it("carries lead, appointment and customer-profile links forward", () => {
    const payload = buildDocumentPayload("quote", "update", fields(), REVISION, { customerId: CUSTOMER, leadId: LEAD, appointmentId: APPOINTMENT, customerProfileId: PROFILE });
    expect(payload).toMatchObject({ leadId: LEAD, appointmentId: APPOINTMENT, customerProfileId: PROFILE });
  });

  it("drops the customer profile when the customer is changed", () => {
    const payload = buildDocumentPayload("invoice", "update", fields({ customerId: OTHER_CUSTOMER }), REVISION, { customerId: CUSTOMER, customerProfileId: PROFILE });
    expect(payload).not.toHaveProperty("customerProfileId");
    expect(payload.customerId).toBe(OTHER_CUSTOMER);
  });

  it("ignores origin values that are not UUIDs", () => {
    const payload = buildDocumentPayload("quote", "update", fields(), REVISION, { leadId: "'; drop table", appointmentId: "../x" });
    expect(payload).not.toHaveProperty("leadId");
    expect(payload).not.toHaveProperty("appointmentId");
  });

  it("works the tax rate back out of the stored tax amount", () => {
    const revision = { totals: { taxTotal: "7.50" }, lineItems: [{ taxable: true, lineTotal: "100.00" }, { taxable: false, lineTotal: "40.00" }] };
    expect(deriveTaxRatePercent(revision)).toBe("7.5");
    expect(deriveTaxRatePercent({ totals: { taxTotal: "0.00" }, lineItems: [] })).toBe("");
    expect(deriveTaxRatePercent(null)).toBe("");
  });

  it("keeps a service-catalogue link only when it is a UUID", () => {
    const withService = buildDocumentPayload("quote", "create", fields({ lines: [line({ serviceOfferingId: CUSTOMER }), line({ serviceOfferingId: "nope" })] }));
    const items = withService.lineItems as Record<string, unknown>[];
    expect(items[0].serviceOfferingId).toBe(CUSTOMER);
    expect(items[1]).not.toHaveProperty("serviceOfferingId");
  });
});

describe("client-side validation catches bad input before it is sent", () => {
  it("accepts a normal document", () => expect(validateDocumentForm("quote", fields())).toBeNull());
  it.each([
    ["no lines", fields({ lines: [] })],
    ["too many lines", fields({ lines: Array.from({ length: MAX_LINES + 1 }, () => line()) })],
    ["empty description", fields({ lines: [line({ description: "   " })] })],
    ["zero quantity", fields({ lines: [line({ quantity: "0" })] })],
    ["negative price", fields({ lines: [line({ unitPrice: "-5" })] })],
    ["three decimals", fields({ lines: [line({ unitPrice: "1.005" })] })],
    ["exponent notation", fields({ lines: [line({ unitPrice: "1e9" })] })],
    ["discount above line amount", fields({ lines: [line({ quantity: "1", unitPrice: "10", discountAmount: "11" })] })],
    ["tax above 100", fields({ taxRatePercent: "101" })],
    ["non-UUID customer", fields({ customerId: "abc" })],
    ["bad date", fields({ expiresAt: "31/12/2026" })],
  ])("rejects %s", (_name, input) => expect(validateDocumentForm("quote", input)).not.toBeNull());

  it("rejects an invoice due before it was issued", () => {
    expect(validateDocumentForm("invoice", fields({ issueDate: "2026-10-10", dueDate: "2026-10-01" }))).not.toBeNull();
  });
});

describe("customer links", () => {
  it("only shows absolute https URLs without credentials", () => {
    expect(safeHttpsUrl("https://chakusarecovery.com/q/abc")).toBe("https://chakusarecovery.com/q/abc");
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("http://chakusarecovery.com/q/abc")).toBeNull();
    expect(safeHttpsUrl("https://user:pass@evil.example/")).toBeNull();
    expect(safeHttpsUrl("/relative")).toBeNull();
    expect(safeHttpsUrl(undefined)).toBeNull();
  });

  it("validates ids before they are used in a request path", () => {
    expect(isUuid(CUSTOMER)).toBe(true);
    expect(isUuid("../../admin")).toBe(false);
    expect(isUuid(`${CUSTOMER}/void`)).toBe(false);
  });
});
