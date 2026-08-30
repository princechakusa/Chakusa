import type Stripe from "stripe";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { config } from "../../lib/config.js";
import {
  defaultStripePaymentProvider,
  type StripePaymentProvider,
} from "../../lib/payments/stripeProvider.js";
import { recordOutboxEvent } from "../../lib/outbox.js";

const ZERO_DECIMAL = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);
const toMinor = (amount: number, currency: string) =>
  Math.round(amount * (ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100));
function requireEnabled() {
  if (!config.STRIPE_PAYMENTS_ENABLED)
    throw ApiError.conflict(
      "Stripe payments are not enabled for this environment",
    );
}

export async function createConnectLink(
  businessId: string,
  provider: StripePaymentProvider = defaultStripePaymentProvider,
) {
  requireEnabled();
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
  });
  const accountId =
    business.stripeAccountId ??
    (await provider.createConnectedAccount({
      businessId,
      businessName: business.name,
      country: business.country,
    }));
  if (!business.stripeAccountId)
    await prisma.business.update({
      where: { id: businessId },
      data: { stripeAccountId: accountId },
    });
  return { url: await provider.createAccountLink(accountId) };
}

export async function connectStatus(
  businessId: string,
  provider: StripePaymentProvider = defaultStripePaymentProvider,
) {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { stripeAccountId: true },
  });
  if (!business.stripeAccountId)
    return {
      connected: false,
      chargesEnabled: false,
      detailsSubmitted: false,
      payoutsEnabled: false,
    };
  const status = await provider.getAccountStatus(business.stripeAccountId);
  return { connected: true, ...status };
}

export async function createAppointmentPaymentLink(
  businessId: string,
  appointmentId: string,
  kind: "deposit" | "balance" | "full",
  provider: StripePaymentProvider = defaultStripePaymentProvider,
) {
  requireEnabled();
  const appointment = await prisma.appointment.findFirst({
    where: { id: appointmentId, businessId },
    include: { customer: true, business: true },
  });
  if (!appointment) throw ApiError.notFound("Appointment not found");
  if (!appointment.business.stripeAccountId)
    throw ApiError.conflict("Connect Stripe before creating payment links");
  const account = await provider.getAccountStatus(
    appointment.business.stripeAccountId,
  );
  if (!account.chargesEnabled)
    throw ApiError.conflict(
      "Stripe onboarding must be completed before accepting payments",
    );
  const price = appointment.price?.toNumber();
  if (!price || price <= 0)
    throw ApiError.conflict("This appointment does not have a payable price");
  const paid = appointment.paidAmount.toNumber();
  const remaining = Math.max(0, price - paid);
  const amount =
    kind === "deposit"
      ? Math.min(
          remaining,
          Math.max(0, (appointment.depositAmount?.toNumber() ?? 0) - paid),
        )
      : remaining;
  if (amount <= 0)
    throw ApiError.conflict(
      kind === "deposit"
        ? "The deposit has already been paid or is not required"
      : "This appointment has no outstanding balance",
    );
  const existing = await prisma.appointmentPaymentTransaction.findFirst({
    where: { appointmentId, businessId, kind, status: "pending", checkoutUrl: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  const currency = (appointment.business.currency ?? "USD").toUpperCase();
  const transaction = await prisma.appointmentPaymentTransaction.create({
    data: { businessId, appointmentId, kind, amount, currency },
  });
  try {
    const checkout = await provider.createCheckout({
      accountId: appointment.business.stripeAccountId,
      transactionId: transaction.id,
      appointmentId,
      businessId,
      label: `${appointment.serviceName} — ${kind === "deposit" ? "deposit" : "payment"}`,
      amountMinor: toMinor(amount, currency),
      currency,
      customerEmail: appointment.customer?.email,
    });
    return prisma.appointmentPaymentTransaction.update({
      where: { id: transaction.id },
      data: {
        stripeCheckoutSessionId: checkout.sessionId,
        checkoutUrl: checkout.url,
      },
    });
  } catch (error) {
    await prisma.appointmentPaymentTransaction.update({
      where: { id: transaction.id },
      data: {
        status: "failed",
        failureCode:
          error instanceof Error
            ? error.message.slice(0, 200)
            : "provider_error",
      },
    });
    throw error;
  }
}

export function listAppointmentPayments(
  businessId: string,
  appointmentId: string,
) {
  return prisma.appointmentPaymentTransaction.findMany({
    where: { businessId, appointmentId },
    orderBy: { createdAt: "desc" },
  });
}

export async function refundPayment(
  businessId: string,
  transactionId: string,
  amount: number | undefined,
  provider: StripePaymentProvider = defaultStripePaymentProvider,
) {
  requireEnabled();
  const transaction = await prisma.appointmentPaymentTransaction.findFirst({
    where: { id: transactionId, businessId },
    include: { business: true },
  });
  if (
    !transaction?.stripePaymentIntentId ||
    !transaction.business.stripeAccountId ||
    !["paid", "partially_refunded"].includes(transaction.status)
  )
    throw ApiError.conflict("This payment cannot be refunded");
  const refundable =
    transaction.amount.toNumber() - transaction.refundedAmount.toNumber();
  const refundAmount = amount ?? refundable;
  if (refundAmount <= 0 || refundAmount > refundable)
    throw ApiError.badRequest("Refund amount exceeds the refundable balance");
  await provider.createRefund({
    accountId: transaction.business.stripeAccountId,
    paymentIntentId: transaction.stripePaymentIntentId,
    amountMinor: toMinor(refundAmount, transaction.currency),
  });
  return prisma.$transaction(async (tx) => {
    const nextRefunded = transaction.refundedAmount.toNumber() + refundAmount;
    const updated = await tx.appointmentPaymentTransaction.update({
      where: { id: transaction.id },
      data: {
        refundedAmount: nextRefunded,
        refundedAt: new Date(),
        status:
          nextRefunded >= transaction.amount.toNumber()
            ? "refunded"
            : "partially_refunded",
      },
    });
    const appointment = await tx.appointment.findUniqueOrThrow({
      where: { id: transaction.appointmentId },
    });
    const nextPaid = Math.max(
      0,
      appointment.paidAmount.toNumber() - refundAmount,
    );
    const total = appointment.price?.toNumber();
    await tx.appointment.update({
      where: { id: appointment.id },
      data: {
        paidAmount: nextPaid,
        paymentStatus:
          nextPaid <= 0
            ? "unpaid"
            : total != null && nextPaid >= total
              ? "paid"
              : "partially_paid",
      },
    });
    await recordOutboxEvent(tx, { dedupeKey: `payment:${transaction.id}:refund:${updated.updatedAt.toISOString()}`, aggregateType: "payment", aggregateId: transaction.id, eventType: "PaymentRefunded", tenantId: businessId, businessId, payload: { id: transaction.id, amount: refundAmount } });
    return updated;
  });
}

export async function applyStripeEvent(event: Stripe.Event) {
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    const transactionId = session.metadata?.chakusaTransactionId;
    if (!transactionId || session.payment_status !== "paid") return;
    const transaction = await prisma.appointmentPaymentTransaction.findUnique({
      where: { id: transactionId },
      include: { business: true },
    });
    if (!transaction || transaction.status === "paid") return;
    if (
      event.account !== transaction.business.stripeAccountId ||
      session.id !== transaction.stripeCheckoutSessionId ||
      session.amount_total !==
        toMinor(transaction.amount.toNumber(), transaction.currency) ||
      session.currency?.toUpperCase() !== transaction.currency.toUpperCase()
    )
      throw ApiError.badRequest(
        "Stripe payment metadata does not match Chakusa records",
      );
    const paymentIntentId =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!paymentIntentId)
      throw ApiError.badRequest("Paid Checkout Session has no PaymentIntent");
    await prisma.$transaction(async (tx) => {
      // Stripe retries events. Claim the transaction atomically so a duplicate
      // delivery can never increment the appointment balance twice.
      const claimed = await tx.appointmentPaymentTransaction.updateMany({
        where: { id: transaction.id, status: "pending" },
        data: {
          status: "paid",
          paidAt: new Date(),
          stripePaymentIntentId: paymentIntentId,
          failureCode: null,
        },
      });
      if (claimed.count !== 1) return;
      const appointment = await tx.appointment.findUniqueOrThrow({
        where: { id: transaction.appointmentId },
      });
      const paidAmount =
        appointment.paidAmount.toNumber() + transaction.amount.toNumber();
      const total = appointment.price?.toNumber();
      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          paidAmount,
          paymentStatus:
            total != null && paidAmount >= total ? "paid" : "partially_paid",
        },
      });
      await recordOutboxEvent(tx, { dedupeKey: `payment:${transaction.id}:received`, aggregateType: "payment", aggregateId: transaction.id, eventType: "PaymentReceived", tenantId: transaction.businessId, businessId: transaction.businessId, payload: { id: transaction.id, appointmentId: transaction.appointmentId, amount: transaction.amount.toNumber(), currency: transaction.currency } });
    });
  } else if (
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    const session = event.data.object as Stripe.Checkout.Session;
    const transactionId = session.metadata?.chakusaTransactionId;
    if (transactionId)
      await prisma.appointmentPaymentTransaction.updateMany({
        where: {
          id: transactionId,
          status: "pending",
          stripeCheckoutSessionId: session.id,
        },
        data: { status: "failed", failureCode: event.type },
      });
  }
}
