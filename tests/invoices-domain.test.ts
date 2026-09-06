import { describe, expect, it } from "vitest";
import {
  assertLegalInvoiceTransition,
  calculateInvoiceTotals,
  canSendInvoice,
  formatInvoiceNumber,
  isLegalInvoiceTransition,
  validateInvoiceTransition,
} from "../src/lib/invoices/invoices.domain.js";
import { ApiError } from "../src/lib/errors.js";

// PROGRAM 3 / Invoicing I1: pure domain logic.

describe("calculateInvoiceTotals", () => {
  it("mirrors the commercial-document math: 2 x 50 - 10 discount => total 90.00", () => {
    const totals = calculateInvoiceTotals({ lineItems: [{ quantity: "2", unitPrice: "50", discountAmount: "10" }] });
    expect(totals).toMatchObject({ subtotal: "100.00", discountTotal: "10.00", taxTotal: "0.00", total: "90.00" });
    expect(totals.lineItems[0]!.lineTotal).toBe("90.00");
  });

  it("applies tax only to taxable lines' discounted total", () => {
    const totals = calculateInvoiceTotals({
      lineItems: [
        { quantity: "1", unitPrice: "100", taxable: true },
        { quantity: "1", unitPrice: "50", taxable: false },
      ],
      taxRatePercent: 10,
    });
    expect(totals).toMatchObject({ subtotal: "150.00", taxTotal: "10.00", total: "160.00" });
  });

  it("rounds each line to 2dp before summing (ROUND_HALF_UP)", () => {
    const totals = calculateInvoiceTotals({ lineItems: [{ quantity: "3", unitPrice: "0.335" }] });
    expect(totals.subtotal).toBe("1.01");
    expect(totals.total).toBe("1.01");
  });

  it("rejects an empty list, non-positive quantity, negative price/discount, and over-discount", () => {
    expect(() => calculateInvoiceTotals({ lineItems: [] })).toThrow(ApiError);
    expect(() => calculateInvoiceTotals({ lineItems: [{ quantity: "0", unitPrice: "1" }] })).toThrow(ApiError);
    expect(() => calculateInvoiceTotals({ lineItems: [{ quantity: "1", unitPrice: "-1" }] })).toThrow(ApiError);
    expect(() => calculateInvoiceTotals({ lineItems: [{ quantity: "1", unitPrice: "1", discountAmount: "-1" }] })).toThrow(ApiError);
    expect(() => calculateInvoiceTotals({ lineItems: [{ quantity: "1", unitPrice: "10", discountAmount: "20" }] })).toThrow(ApiError);
  });

  it("keeps trailing-zero 2dp formatting", () => {
    const totals = calculateInvoiceTotals({ lineItems: [{ quantity: "1", unitPrice: "25" }] });
    expect(totals.total).toBe("25.00");
    expect(totals.subtotal).toBe("25.00");
  });
});

describe("invoice lifecycle transitions", () => {
  it("DRAFT -> SEND -> SENT, DRAFT/SENT -> VOID -> VOID (terminal)", () => {
    expect(validateInvoiceTransition("DRAFT", "SEND")).toEqual({ ok: true, next: "SENT" });
    expect(validateInvoiceTransition("DRAFT", "VOID")).toEqual({ ok: true, next: "VOID" });
    expect(validateInvoiceTransition("SENT", "VOID")).toEqual({ ok: true, next: "VOID" });
  });
  it("rejects illegal transitions without throwing", () => {
    expect(validateInvoiceTransition("SENT", "SEND").ok).toBe(false);
    expect(validateInvoiceTransition("VOID", "SEND").ok).toBe(false);
    expect(validateInvoiceTransition("VOID", "VOID").ok).toBe(false);
  });
  it("isLegalInvoiceTransition agrees", () => {
    expect(isLegalInvoiceTransition("DRAFT", "SEND")).toBe(true);
    expect(isLegalInvoiceTransition("SENT", "SEND")).toBe(false);
    expect(isLegalInvoiceTransition("VOID", "VOID")).toBe(false);
  });
  it("assertLegalInvoiceTransition returns the next status or throws ApiError.conflict (409)", () => {
    expect(assertLegalInvoiceTransition("DRAFT", "SEND")).toBe("SENT");
    try {
      assertLegalInvoiceTransition("SENT", "SEND");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).statusCode).toBe(409);
    }
  });
});

describe("canSendInvoice", () => {
  it("ok from DRAFT with valid line items, returning computed totals", () => {
    const result = canSendInvoice({ status: "DRAFT", lineItems: [{ quantity: "1", unitPrice: "10" }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.totals.total).toBe("10.00");
  });
  it("not ok: non-DRAFT status, zero line items, or invalid amounts", () => {
    expect(canSendInvoice({ status: "SENT", lineItems: [{ quantity: "1", unitPrice: "10" }] }).ok).toBe(false);
    expect(canSendInvoice({ status: "VOID", lineItems: [{ quantity: "1", unitPrice: "10" }] }).ok).toBe(false);
    expect(canSendInvoice({ status: "DRAFT", lineItems: [] }).ok).toBe(false);
    expect(canSendInvoice({ status: "DRAFT", lineItems: [{ quantity: "0", unitPrice: "10" }] }).ok).toBe(false);
  });
});

describe("formatInvoiceNumber", () => {
  it("formats INV-<year>-<padded>", () => {
    expect(formatInvoiceNumber({ year: 2026, counterValue: 1 })).toBe("INV-2026-0001");
    expect(formatInvoiceNumber({ year: 2026, counterValue: 42 })).toBe("INV-2026-0042");
    expect(formatInvoiceNumber({ year: 2026, counterValue: 12345 })).toBe("INV-2026-12345");
  });
  it("rejects out-of-range years and non-positive counters", () => {
    expect(() => formatInvoiceNumber({ year: 1999, counterValue: 1 })).toThrow(ApiError);
    expect(() => formatInvoiceNumber({ year: 2101, counterValue: 1 })).toThrow(ApiError);
    expect(() => formatInvoiceNumber({ year: 2026, counterValue: 0 })).toThrow(ApiError);
    expect(() => formatInvoiceNumber({ year: 2026, counterValue: -1 })).toThrow(ApiError);
  });
});
