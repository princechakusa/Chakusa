import type Stripe from "stripe";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { config } from "../../lib/config.js";
import { recordOutboxEvent } from "../../lib/outbox.js";
import { toMinorUnits } from "../../lib/payments/money.js";
import { deriveInvoicePayment, type InvoicePaymentSummary } from "../../lib/invoices/invoicePayments.domain.js";
import { defaultStripePaymentProvider, type StripePaymentProvider } from "../../lib/payments/stripeProvider.js";

// PROGRAM 3 / Invoicing I8: collect an invoice payment over Stripe Connect
// (business <-> customer commerce - never the SaaS subscription rail).
// Mirrors the appointment payment service exactly. Payment STATE is never
// written to the Invoice; it is always derived by
// deriveInvoicePayment() from these transaction rows (locked decision §3).

const PAYMENT_TXN_SELECT = { status: true, amount: true, refundedAmount: true } as const;

function requireEnabled() {
  if (!config.STRIPE_PAYMENTS_ENABLED) {
    throw ApiError.conflict("Stripe payments are not enabled for this environment");
  }
}

/** Load the derived payment position for one invoice (standalone use). */
export async function getInvoicePaymentSummary(businessId: string, invoiceId: string): Promise<InvoicePaymentSummary> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, businessId },
    select: {
      status: true,
      dueDate: true,
      currency: true,
      currentRevision: { select: { total: true } },
      payments: { select: PAYMENT_TXN_SELECT },
    },
  });
  if (!invoice) throw ApiError.notFound("Invoice not found");
  return deriveInvoicePayment({
    invoiceStatus: invoice.status,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    invoiceTotal: invoice.currentRevision?.total ?? null,
    transactions: invoice.payments,
  });
}

export async function createInvoicePaymentLink(
  businessId: string,
  invoiceId: string,
  provider: StripePaymentProvider = defaultStripePaymentProvider,
) {
  requireEnabled();

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, businessId },
    select: {
      id: true,
      invoiceNumber: true,
      status: true,
      currency: true,
      dueDate: true,
      currentRevisionId: true,
      currentRevision: { select: { total: true } },
      business: { select: { stripeAccountId: true } },
      customer: { select: { email: true } },
      payments: { select: PAYMENT_TXN_SELECT },
    },
  });
  if (!invoice) throw ApiError.notFound("Invoice not found");
  if (invoice.status !== "SENT" || !invoice.currentRevisionId) {
    throw ApiError.conflict("Only a sent invoice can be paid");
  }
  if (!invoice.business.stripeAccountId) {
    throw ApiError.conflict("Connect Stripe before collecting invoice payments");
  }
  const account = await provider.getAccountStatus(invoice.business.stripeAccountId);
  if (!account.chargesEnabled) {
    throw ApiError.conflict("Stripe onboarding must be completed before accepting payments");
  }

  const summary = deriveInvoicePayment({
    invoiceStatus: invoice.status,
    dueDate: invoice.dueDate,
    currency: invoice.currency,
    invoiceTotal: invoice.currentRevision?.total ?? null,
    transactions: invoice.payments,
  });
  const outstanding = Number(summary.outstandingBalance);
  if (outstanding <= 0) {
    throw ApiError.conflict("This invoice has no outstanding balance");
  }

  const currency = invoice.currency.toUpperCase();

  // Reuse a still-open Checkout Session rather than minting a second one.
  const existing = await prisma.invoicePaymentTransaction.findFirst({
    where: { invoiceId, businessId, status: "pending", checkoutUrl: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (existing && existing.amount.toNumber() === outstanding) return existing;

  const transaction = await prisma.invoicePaymentTransaction.create({
    data: { businessId, invoiceId, invoiceRevisionId: invoice.currentRevisionId, amount: outstanding, currency },
  });

  try {
    const checkout = await provider.createCheckout({
      accountId: invoice.business.stripeAccountId,
      transactionId: transaction.id,
      invoiceId,
      businessId,
      label: `Invoice ${invoice.invoiceNumber}`,
      amountMinor: toMinorUnits(outstanding, currency),
      currency,
      customerEmail: invoice.customer?.email,
    });
    return await prisma.invoicePaymentTransaction.update({
      where: { id: transaction.id },
      data: { stripeCheckoutSessionId: checkout.sessionId, checkoutUrl: checkout.url },
    });
  } catch (error) {
    await prisma.invoicePaymentTransaction.update({
      where: { id: transaction.id },
      data: { status: "failed", failureCode: error instanceof Error ? error.message.slice(0, 200) : "provider_error" },
    });
    throw error;
  }
}

export function listInvoicePayments(businessId: string, invoiceId: string) {
  return prisma.invoicePaymentTransaction.findMany({
    where: { businessId, invoiceId },
    orderBy: { createdAt: "desc" },
  });
}

export async function refundInvoicePayment(
  businessId: string,
  invoiceId: string,
  transactionId: string,
  amount: number | undefined,
  provider: StripePaymentProvider = defaultStripePaymentProvider,
) {
  requireEnabled();
  const transaction = await prisma.invoicePaymentTransaction.findFirst({
    where: { id: transactionId, businessId, invoiceId },
    include: { business: true },
  });
  if (
    !transaction?.stripePaymentIntentId ||
    !transaction.business.stripeAccountId ||
    !["paid", "partially_refunded"].includes(transaction.status)
  ) {
    throw ApiError.conflict("This payment cannot be refunded");
  }
  const refundable = transaction.amount.toNumber() - transaction.refundedAmount.toNumber();
  const refundAmount = amount ?? refundable;
  if (refundAmount <= 0 || refundAmount > refundable) {
    throw ApiError.badRequest("Refund amount exceeds the refundable balance");
  }
  await provider.createRefund({
    accountId: transaction.business.stripeAccountId,
    paymentIntentId: transaction.stripePaymentIntentId,
    amountMinor: toMinorUnits(refundAmount, transaction.currency),
  });
  return prisma.$transaction(async (tx) => {
    const nextRefunded = transaction.refundedAmount.toNumber() + refundAmount;
    const updated = await tx.invoicePaymentTransaction.update({
      where: { id: transaction.id },
      data: {
        refundedAmount: nextRefunded,
        refundedAt: new Date(),
        status: nextRefunded >= transaction.amount.toNumber() ? "refunded" : "partially_refunded",
      },
    });
    await recordOutboxEvent(tx, {
      dedupeKey: `invoice-payment:${transaction.id}:refund:${updated.updatedAt.toISOString()}`,
      aggregateType: "invoice_payment",
      aggregateId: transaction.id,
      eventType: "InvoicePaymentRefunded",
      tenantId: businessId,
      businessId,
      payload: { id: transaction.id, invoiceId, amount: refundAmount },
    });
    return updated;
  });
}

/**
 * Stripe webhook side of an invoice payment. Called alongside
 * applyStripeEvent(); no-ops for any event that is not an invoice
 * Checkout Session. A retried delivery cannot double-count: the row is
 * claimed atomically (status pending -> paid).
 */
export async function applyInvoiceStripeEvent(event: Stripe.Event) {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (!session.metadata?.chakusaInvoiceId) return;
    const transactionId = session.metadata?.chakusaTransactionId;
    if (!transactionId || session.payment_status !== "paid") return;

    const transaction = await prisma.invoicePaymentTransaction.findUnique({
      where: { id: transactionId },
      include: { business: true },
    });
    if (!transaction || transaction.status === "paid") return;
    if (
      event.account !== transaction.business.stripeAccountId ||
      session.id !== transaction.stripeCheckoutSessionId ||
      session.amount_total !== toMinorUnits(transaction.amount.toNumber(), transaction.currency) ||
      session.currency?.toUpperCase() !== transaction.currency.toUpperCase()
    ) {
      throw ApiError.badRequest("Stripe payment metadata does not match Chakusa records");
    }
    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!paymentIntentId) throw ApiError.badRequest("Paid Checkout Session has no PaymentIntent");

    await prisma.$transaction(async (tx) => {
      const claimed = await tx.invoicePaymentTransaction.updateMany({
        where: { id: transaction.id, status: "pending" },
        data: { status: "paid", paidAt: new Date(), stripePaymentIntentId: paymentIntentId, failureCode: null },
      });
      if (claimed.count !== 1) return;
      await recordOutboxEvent(tx, {
        dedupeKey: `invoice-payment:${transaction.id}:received`,
        aggregateType: "invoice_payment",
        aggregateId: transaction.id,
        eventType: "InvoicePaymentReceived",
        tenantId: transaction.businessId,
        businessId: transaction.businessId,
        payload: {
          id: transaction.id,
          invoiceId: transaction.invoiceId,
          amount: transaction.amount.toNumber(),
          currency: transaction.currency,
        },
      });
    });
  } else if (
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    if (!session.metadata?.chakusaInvoiceId) return;
    const transactionId = session.metadata?.chakusaTransactionId;
    if (transactionId) {
      await prisma.invoicePaymentTransaction.updateMany({
        where: { id: transactionId, status: "pending", stripeCheckoutSessionId: session.id },
        data: { status: "failed", failureCode: event.type },
      });
    }
  }
}
