import { prisma } from "../../lib/prisma.js";
import { deriveInvoicePayment } from "../../lib/invoices/invoicePayments.domain.js";
import { summariseFinancials } from "../../lib/financial/financial.domain.js";
import type { FinancialSummaryQuery } from "./financial.schemas.js";

// PROGRAM 3 / Financial Management F2 (summary). The money-in / money-out
// view. Money-IN (revenue) and outstanding balances are DERIVED here from
// the authoritative provider payment ledgers and the frozen invoice
// revision snapshots - never read from a stored figure. Money-OUT
// (expenses, mileage) is summed from the business's own recorded rows.
// summariseFinancials keeps every currency independent.

export async function getFinancialSummary(businessId: string, query: FinancialSummaryQuery) {
  const paidWindow = { gte: query.from, lte: query.to };

  const [appointmentTxns, invoiceTxns, expenses, mileage, sentInvoices] = await prisma.$transaction([
    prisma.appointmentPaymentTransaction.findMany({
      where: { businessId, status: { in: ["paid", "partially_refunded", "refunded"] }, paidAt: paidWindow },
      select: { status: true, amount: true, refundedAmount: true, currency: true },
    }),
    prisma.invoicePaymentTransaction.findMany({
      where: { businessId, status: { in: ["paid", "partially_refunded", "refunded"] }, paidAt: paidWindow },
      select: { status: true, amount: true, refundedAmount: true, currency: true },
    }),
    prisma.expense.findMany({
      where: { businessId, deletedAt: null, spentAt: { gte: query.from, lte: query.to } },
      select: { amount: true, currency: true, categoryId: true, category: { select: { name: true } } },
    }),
    prisma.mileageTrip.findMany({
      where: { businessId, deletedAt: null, tripDate: { gte: query.from, lte: query.to } },
      select: { amount: true, currency: true },
    }),
    prisma.invoice.findMany({
      where: { businessId, status: "SENT" },
      select: {
        status: true,
        dueDate: true,
        currency: true,
        currentRevision: { select: { total: true } },
        payments: { select: { status: true, amount: true, refundedAmount: true } },
      },
    }),
  ]);

  const outstandingRows = sentInvoices.map((invoice) => {
    const derived = deriveInvoicePayment({
      invoiceStatus: invoice.status,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      invoiceTotal: invoice.currentRevision?.total ?? 0,
      transactions: invoice.payments,
    });
    return { outstandingBalance: derived.outstandingBalance, currency: invoice.currency };
  });

  const summary = summariseFinancials({
    revenueRows: [...appointmentTxns, ...invoiceTxns],
    expenseRows: expenses.map((expense) => ({
      amount: expense.amount,
      currency: expense.currency,
      categoryId: expense.categoryId,
      categoryName: expense.category?.name ?? null,
    })),
    mileageRows: mileage.map((trip) => ({ amount: trip.amount, currency: trip.currency })),
    outstandingRows,
  });

  return {
    from: query.from,
    to: query.to,
    currencies: summary.currencies,
  };
}
