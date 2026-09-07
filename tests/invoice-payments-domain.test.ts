import { describe, expect, it } from "vitest";
import { deriveInvoicePayment } from "../src/lib/invoices/invoicePayments.domain.js";

// PROGRAM 3 / Invoicing I8: pure derivation of PAID / PARTIALLY_PAID /
// OVERDUE from settled transactions minus refunds.

const base = {
  invoiceStatus: "SENT" as const,
  currency: "USD",
  invoiceTotal: "140.00",
  dueDate: null,
};

describe("deriveInvoicePayment", () => {
  it("is open (null) with no transactions and no due date", () => {
    const s = deriveInvoicePayment({ ...base, transactions: [] });
    expect(s).toMatchObject({ amountPaid: "0.00", amountRefunded: "0.00", outstandingBalance: "140.00", state: null });
  });

  it("counts only settled transactions toward money-in", () => {
    const s = deriveInvoicePayment({
      ...base,
      transactions: [
        { status: "pending", amount: "140.00", refundedAmount: "0" },
        { status: "failed", amount: "140.00", refundedAmount: "0" },
      ],
    });
    expect(s).toMatchObject({ amountPaid: "0.00", outstandingBalance: "140.00", state: null });
  });

  it("is PAID once the full balance is settled", () => {
    const s = deriveInvoicePayment({ ...base, transactions: [{ status: "paid", amount: "140.00", refundedAmount: "0" }] });
    expect(s).toMatchObject({ amountPaid: "140.00", outstandingBalance: "0.00", state: "PAID" });
  });

  it("is PARTIALLY_PAID when some but not all is settled and it is not overdue", () => {
    const s = deriveInvoicePayment({ ...base, transactions: [{ status: "paid", amount: "50.00", refundedAmount: "0" }] });
    expect(s).toMatchObject({ amountPaid: "50.00", outstandingBalance: "90.00", state: "PARTIALLY_PAID" });
  });

  it("subtracts refunds from the net paid amount", () => {
    const s = deriveInvoicePayment({
      ...base,
      transactions: [{ status: "partially_refunded", amount: "140.00", refundedAmount: "40.00" }],
    });
    expect(s).toMatchObject({ amountPaid: "140.00", amountRefunded: "40.00", outstandingBalance: "40.00", state: "PARTIALLY_PAID" });
  });

  it("is OVERDUE when a past-due SENT invoice still has a balance", () => {
    const s = deriveInvoicePayment({
      ...base,
      dueDate: new Date("2026-01-01T00:00:00Z"),
      now: new Date("2026-02-01T00:00:00Z"),
      transactions: [],
    });
    expect(s.state).toBe("OVERDUE");
  });

  it("OVERDUE takes precedence over PARTIALLY_PAID for a late invoice", () => {
    const s = deriveInvoicePayment({
      ...base,
      dueDate: new Date("2026-01-01T00:00:00Z"),
      now: new Date("2026-02-01T00:00:00Z"),
      transactions: [{ status: "paid", amount: "50.00", refundedAmount: "0" }],
    });
    expect(s.state).toBe("OVERDUE");
  });

  it("PAID beats OVERDUE - a fully paid invoice is never overdue", () => {
    const s = deriveInvoicePayment({
      ...base,
      dueDate: new Date("2026-01-01T00:00:00Z"),
      now: new Date("2026-02-01T00:00:00Z"),
      transactions: [{ status: "paid", amount: "140.00", refundedAmount: "0" }],
    });
    expect(s.state).toBe("PAID");
  });

  it("a VOID invoice past its due date is never OVERDUE (lifecycle bars collection)", () => {
    const s = deriveInvoicePayment({
      ...base,
      invoiceStatus: "VOID",
      dueDate: new Date("2026-01-01T00:00:00Z"),
      now: new Date("2026-02-01T00:00:00Z"),
      transactions: [],
    });
    expect(s.state).toBeNull();
  });

  it("never reports a negative outstanding balance", () => {
    const s = deriveInvoicePayment({ ...base, transactions: [{ status: "paid", amount: "200.00", refundedAmount: "0" }] });
    expect(s.outstandingBalance).toBe("0.00");
    expect(s.state).toBe("PAID");
  });
});
