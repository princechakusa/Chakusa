import { describe, expect, it } from "vitest";
import { ApiError } from "../src/lib/errors.js";
import {
  assertLegalQuoteTransition,
  calculateQuoteTotals,
  canSendQuote,
  formatDocumentNumber,
  isLegalQuoteTransition,
  validateQuoteTransition,
} from "../src/lib/quotes/quotes.domain.js";

describe("calculateQuoteTotals", () => {
  it("computes a single line item with no tax or discount", () => {
    const result = calculateQuoteTotals({ lineItems: [{ quantity: 2, unitPrice: 50 }] });
    expect(result.subtotal).toBe("100.00");
    expect(result.discountTotal).toBe("0.00");
    expect(result.taxTotal).toBe("0.00");
    expect(result.total).toBe("100.00");
    expect(result.lineItems[0]!).toMatchObject({ grossAmount: "100.00", lineTotal: "100.00", taxable: false });
  });

  it("sums multiple line items correctly", () => {
    const result = calculateQuoteTotals({
      lineItems: [
        { quantity: 1, unitPrice: 30 },
        { quantity: 3, unitPrice: 20 },
      ],
    });
    expect(result.subtotal).toBe("90.00");
    expect(result.total).toBe("90.00");
  });

  it("supports a fractional quantity (e.g. 1.5 hours of labor)", () => {
    const result = calculateQuoteTotals({ lineItems: [{ quantity: "1.5", unitPrice: "40.00" }] });
    expect(result.lineItems[0]!.grossAmount).toBe("60.00");
    expect(result.subtotal).toBe("60.00");
  });

  it("applies a flat line-level discount", () => {
    const result = calculateQuoteTotals({ lineItems: [{ quantity: 1, unitPrice: 100, discountAmount: 15 }] });
    expect(result.lineItems[0]!).toMatchObject({ grossAmount: "100.00", discountAmount: "15.00", lineTotal: "85.00" });
    expect(result.discountTotal).toBe("15.00");
    expect(result.total).toBe("85.00");
  });

  it("computes tax only on taxable lines, applied after discount", () => {
    const result = calculateQuoteTotals({
      lineItems: [
        { quantity: 1, unitPrice: 100, taxable: true },
        { quantity: 1, unitPrice: 50, taxable: false },
        { quantity: 1, unitPrice: 20, discountAmount: 10, taxable: true },
      ],
      taxRatePercent: 10,
    });
    // Taxable base = 100.00 (line 1) + 10.00 (line 3, after discount) = 110.00
    expect(result.taxTotal).toBe("11.00");
    expect(result.subtotal).toBe("170.00");
    expect(result.discountTotal).toBe("10.00");
    expect(result.total).toBe("171.00"); // 170 - 10 + 11
  });

  it("defaults zero discount and zero tax when omitted", () => {
    const result = calculateQuoteTotals({ lineItems: [{ quantity: 1, unitPrice: 10 }] });
    expect(result.discountTotal).toBe("0.00");
    expect(result.taxTotal).toBe("0.00");
  });

  it("rejects a negative quantity", () => {
    expect(() => calculateQuoteTotals({ lineItems: [{ quantity: -1, unitPrice: 10 }] })).toThrow(ApiError);
    try {
      calculateQuoteTotals({ lineItems: [{ quantity: -1, unitPrice: 10 }] });
    } catch (error) {
      expect((error as ApiError).statusCode).toBe(400);
    }
  });

  it("rejects a zero quantity (a real line item always represents some amount)", () => {
    expect(() => calculateQuoteTotals({ lineItems: [{ quantity: 0, unitPrice: 10 }] })).toThrow(ApiError);
  });

  it("rejects a negative unit price", () => {
    expect(() => calculateQuoteTotals({ lineItems: [{ quantity: 1, unitPrice: -5 }] })).toThrow(ApiError);
  });

  it("rejects a negative discount", () => {
    expect(() => calculateQuoteTotals({ lineItems: [{ quantity: 1, unitPrice: 10, discountAmount: -1 }] })).toThrow(ApiError);
  });

  it("rejects a discount exceeding the line's own gross amount", () => {
    expect(() => calculateQuoteTotals({ lineItems: [{ quantity: 1, unitPrice: 10, discountAmount: 10.01 }] })).toThrow(ApiError);
  });

  it("allows a discount exactly equal to the gross amount (a fully comped line)", () => {
    const result = calculateQuoteTotals({ lineItems: [{ quantity: 1, unitPrice: 10, discountAmount: 10 }] });
    expect(result.lineItems[0]!.lineTotal).toBe("0.00");
  });

  it("rejects an out-of-range tax rate", () => {
    expect(() => calculateQuoteTotals({ lineItems: [{ quantity: 1, unitPrice: 10 }], taxRatePercent: 101 })).toThrow(ApiError);
    expect(() => calculateQuoteTotals({ lineItems: [{ quantity: 1, unitPrice: 10 }], taxRatePercent: -1 })).toThrow(ApiError);
  });

  it("rejects an empty line-item list", () => {
    expect(() => calculateQuoteTotals({ lineItems: [] })).toThrow(ApiError);
  });

  it("rounds at the line level before summing — proves the chosen order (rounding edge case)", () => {
    // Three identical lines, each exactly on a .005 rounding boundary.
    // Line-first: round(0.005) = 0.01 (half-up) three times -> 0.03.
    // Sum-first (the REJECTED approach): 0.005 * 3 = 0.015 -> round once -> 0.02.
    // These must differ, and this test locks in the line-first result.
    const result = calculateQuoteTotals({
      lineItems: [
        { quantity: 1, unitPrice: "0.005" },
        { quantity: 1, unitPrice: "0.005" },
        { quantity: 1, unitPrice: "0.005" },
      ],
    });
    expect(result.lineItems.every((line) => line.grossAmount === "0.01")).toBe(true);
    expect(result.subtotal).toBe("0.03");
    expect(result.subtotal).not.toBe("0.02"); // the sum-first result this design deliberately avoids
  });

  it("is deterministic across repeated calls with identical input", () => {
    const input = { lineItems: [{ quantity: "2.5", unitPrice: "19.99", discountAmount: "1.11", taxable: true }], taxRatePercent: "8.25" };
    const first = calculateQuoteTotals(input);
    const second = calculateQuoteTotals(input);
    expect(second).toEqual(first);
  });
});

describe("quote lifecycle transitions", () => {
  it("allows every locked-legal transition", () => {
    expect(validateQuoteTransition("DRAFT", "SEND")).toEqual({ ok: true, next: "SENT" });
    expect(validateQuoteTransition("SENT", "REVISE")).toEqual({ ok: true, next: "SENT" });
    expect(validateQuoteTransition("SENT", "ACCEPT")).toEqual({ ok: true, next: "ACCEPTED" });
    expect(validateQuoteTransition("SENT", "DECLINE")).toEqual({ ok: true, next: "DECLINED" });
    expect(validateQuoteTransition("SENT", "CANCEL")).toEqual({ ok: true, next: "CANCELED" });
    expect(validateQuoteTransition("SENT", "EXPIRE")).toEqual({ ok: true, next: "EXPIRED" });
  });

  it("rejects DECLINED -> SENT", () => {
    expect(isLegalQuoteTransition("DECLINED", "SEND")).toBe(false);
    expect(validateQuoteTransition("DECLINED", "SEND").ok).toBe(false);
  });

  it("rejects EXPIRED -> SENT", () => {
    expect(isLegalQuoteTransition("EXPIRED", "SEND")).toBe(false);
  });

  it("rejects CANCELED -> SENT", () => {
    expect(isLegalQuoteTransition("CANCELED", "SEND")).toBe(false);
  });

  it("rejects every transition out of ACCEPTED — terminal, no exceptions", () => {
    for (const action of ["SEND", "REVISE", "ACCEPT", "DECLINE", "CANCEL", "EXPIRE"] as const) {
      expect(isLegalQuoteTransition("ACCEPTED", action)).toBe(false);
    }
  });

  it("rejects every transition out of DECLINED/CANCELED/EXPIRED", () => {
    for (const status of ["DECLINED", "CANCELED", "EXPIRED"] as const) {
      for (const action of ["SEND", "REVISE", "ACCEPT", "DECLINE", "CANCEL", "EXPIRE"] as const) {
        expect(isLegalQuoteTransition(status, action)).toBe(false);
      }
    }
  });

  it("rejects sending a DRAFT twice (DRAFT has no SEND->SEND self-loop)", () => {
    // SEND from DRAFT is legal once; a document that is already SENT must
    // use REVISE, not SEND, to change again.
    expect(isLegalQuoteTransition("SENT", "SEND")).toBe(false);
  });

  it("assertLegalQuoteTransition throws ApiError.conflict for an illegal transition", () => {
    expect(() => assertLegalQuoteTransition("ACCEPTED", "ACCEPT")).toThrow(ApiError);
    try {
      assertLegalQuoteTransition("ACCEPTED", "ACCEPT");
    } catch (error) {
      expect((error as ApiError).statusCode).toBe(409);
      expect((error as ApiError).code).toBe("CONFLICT");
    }
  });

  it("assertLegalQuoteTransition returns the next status for a legal transition", () => {
    expect(assertLegalQuoteTransition("DRAFT", "SEND")).toBe("SENT");
  });
});

describe("canSendQuote", () => {
  it("allows sending a DRAFT with a valid line item", () => {
    const result = canSendQuote({ status: "DRAFT", lineItems: [{ quantity: 1, unitPrice: 50 }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.totals.total).toBe("50.00");
  });

  it("rejects sending a DRAFT with zero line items", () => {
    const result = canSendQuote({ status: "DRAFT", lineItems: [] });
    expect(result.ok).toBe(false);
  });

  it("rejects sending a document whose totals are invalid", () => {
    const result = canSendQuote({ status: "DRAFT", lineItems: [{ quantity: -1, unitPrice: 10 }] });
    expect(result.ok).toBe(false);
  });

  it("rejects sending a document not in DRAFT status", () => {
    for (const status of ["SENT", "ACCEPTED", "DECLINED", "CANCELED", "EXPIRED"] as const) {
      const result = canSendQuote({ status, lineItems: [{ quantity: 1, unitPrice: 10 }] });
      expect(result.ok).toBe(false);
    }
  });
});

describe("formatDocumentNumber", () => {
  it("formats a QUOTE document number with 4-digit zero-padding", () => {
    expect(formatDocumentNumber({ documentType: "QUOTE", year: 2026, counterValue: 42 })).toBe("Q-2026-0042");
  });

  it("formats an ESTIMATE document number", () => {
    expect(formatDocumentNumber({ documentType: "ESTIMATE", year: 2026, counterValue: 7 })).toBe("E-2026-0007");
  });

  it("does not truncate a counter value beyond the pad width", () => {
    expect(formatDocumentNumber({ documentType: "QUOTE", year: 2026, counterValue: 123456 })).toBe("Q-2026-123456");
  });

  it("rejects a non-integer or out-of-range year", () => {
    expect(() => formatDocumentNumber({ documentType: "QUOTE", year: 1999, counterValue: 1 })).toThrow(ApiError);
    expect(() => formatDocumentNumber({ documentType: "QUOTE", year: 2026.5, counterValue: 1 })).toThrow(ApiError);
  });

  it("rejects a non-positive counter value", () => {
    expect(() => formatDocumentNumber({ documentType: "QUOTE", year: 2026, counterValue: 0 })).toThrow(ApiError);
    expect(() => formatDocumentNumber({ documentType: "QUOTE", year: 2026, counterValue: -1 })).toThrow(ApiError);
  });
});
