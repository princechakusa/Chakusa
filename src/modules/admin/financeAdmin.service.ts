import { prisma } from "../../lib/prisma.js";

export async function getAdminFinanceOperations() {
  const [quotes, invoices, invoicePayments, appointmentPayments, recentInvoices, recentQuotes] = await Promise.all([
    prisma.quoteDocument.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.invoice.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.invoicePaymentTransaction.groupBy({ by: ["status", "currency"], _count: { _all: true }, _sum: { amount: true, refundedAmount: true } }),
    prisma.appointmentPaymentTransaction.groupBy({ by: ["status", "currency"], _count: { _all: true }, _sum: { amount: true, refundedAmount: true } }),
    prisma.invoice.findMany({
      orderBy: { updatedAt: "desc" },
      take: 25,
      select: { id: true, invoiceNumber: true, status: true, currency: true, issueDate: true, dueDate: true, updatedAt: true, business: { select: { id: true, name: true } }, currentRevision: { select: { total: true } } },
    }),
    prisma.quoteDocument.findMany({
      orderBy: { updatedAt: "desc" },
      take: 25,
      select: { id: true, documentNumber: true, documentType: true, status: true, currency: true, expiresAt: true, updatedAt: true, business: { select: { id: true, name: true } }, currentRevision: { select: { total: true } } },
    }),
  ]);

  const paymentRows = [
    ...invoicePayments.map((row) => ({ source: "invoice", status: row.status, currency: row.currency, count: row._count._all, amount: Number(row._sum.amount ?? 0), refundedAmount: Number(row._sum.refundedAmount ?? 0) })),
    ...appointmentPayments.map((row) => ({ source: "appointment", status: row.status, currency: row.currency, count: row._count._all, amount: Number(row._sum.amount ?? 0), refundedAmount: Number(row._sum.refundedAmount ?? 0) })),
  ];

  return {
    quotes: Object.fromEntries(quotes.map((row) => [row.status, row._count._all])),
    invoices: Object.fromEntries(invoices.map((row) => [row.status, row._count._all])),
    payments: paymentRows,
    recentInvoices: recentInvoices.map((row) => ({ ...row, total: row.currentRevision ? Number(row.currentRevision.total) : null, currentRevision: undefined })),
    recentQuotes: recentQuotes.map((row) => ({ ...row, total: row.currentRevision ? Number(row.currentRevision.total) : null, currentRevision: undefined })),
  };
}
