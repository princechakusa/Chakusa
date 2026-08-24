import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { prisma } from "../src/lib/prisma.js";
import { config } from "../src/lib/config.js";
import type { StripePaymentProvider } from "../src/lib/payments/stripeProvider.js";
import { authHeader, createTestApp, registerAccount, resetDatabase } from "./helpers.js";

let event: Stripe.Event;
const provider: StripePaymentProvider = {
  createConnectedAccount: async () => "acct_test_business",
  createAccountLink: async () => "https://connect.stripe.test/onboard",
  getAccountStatus: async () => ({ chargesEnabled: true, detailsSubmitted: true, payoutsEnabled: true }),
  createCheckout: async input => ({ sessionId: `cs_${input.transactionId}`, url: "https://checkout.stripe.test/session" }),
  createRefund: async input => ({ id: "re_test", amount: input.amountMinor ?? 0, status: "succeeded" }),
  constructEvent: () => event,
};

describe("Stripe Connect appointment payments", () => {
  let app: FastifyInstance;
  beforeAll(async () => { config.STRIPE_PAYMENTS_ENABLED = true; app = await createTestApp({ stripePaymentProvider: provider }); });
  afterEach(resetDatabase);
  afterAll(async () => { config.STRIPE_PAYMENTS_ENABLED = false; await app.close(); await prisma.$disconnect(); });

  it("onboards a connected account, collects a verified deposit, and refunds it", async () => {
    const account = await registerAccount(app, { email: "stripe-payment@example.com", businessName: "Stripe Studio" }); const headers = authHeader(account.token);
    await prisma.business.update({ where: { id: account.businessId }, data: { currency: "USD" } });
    const customer = await prisma.customer.create({ data: { businessId: account.businessId, name: "Paying Customer", email: "customer@example.com" } });
    const appointment = await prisma.appointment.create({ data: { businessId: account.businessId, customerId: customer.id, createdByUserId: account.userId, serviceName: "Service", startsAt: new Date("2026-09-10T10:00:00Z"), endsAt: new Date("2026-09-10T11:00:00Z"), price: 100, depositAmount: 25 } });

    const connect = await app.inject({ method: "POST", url: "/payments/connect/link", headers });
    expect(connect.statusCode).toBe(200); expect(connect.json().url).toContain("stripe.test");
    expect((await prisma.business.findUniqueOrThrow({ where: { id: account.businessId } })).stripeAccountId).toBe("acct_test_business");

    const link = await app.inject({ method: "POST", url: `/payments/appointments/${appointment.id}/link`, headers, payload: { kind: "deposit" } });
    expect(link.statusCode).toBe(201); expect(link.json()).toMatchObject({ amount: "25", currency: "USD", status: "pending" });
    const transaction = await prisma.appointmentPaymentTransaction.findFirstOrThrow({ where: { appointmentId: appointment.id } });
    event = { id: "evt_paid", object: "event", api_version: null, created: 0, livemode: false, pending_webhooks: 0, request: null, type: "checkout.session.completed", account: "acct_test_business", data: { object: { id: transaction.stripeCheckoutSessionId, object: "checkout.session", payment_status: "paid", amount_total: 2500, currency: "usd", payment_intent: "pi_test", metadata: { chakusaTransactionId: transaction.id } } as unknown as Stripe.Checkout.Session } };
    expect((await app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "stripe-signature": "valid" }, payload: {} })).statusCode).toBe(200);
    expect(await prisma.appointment.findUnique({ where: { id: appointment.id }, select: { paidAmount: true, paymentStatus: true } })).toMatchObject({ paidAmount: expect.objectContaining({}), paymentStatus: "partially_paid" });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).paidAmount.toNumber()).toBe(25);

    const refund = await app.inject({ method: "POST", url: `/payments/${transaction.id}/refund`, headers, payload: { amount: 10 } });
    expect(refund.statusCode).toBe(200); expect(refund.json()).toMatchObject({ status: "partially_refunded", refundedAmount: "10" });
    expect((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).paidAmount.toNumber()).toBe(15);
  });
});
