import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { prisma } from "../src/lib/prisma.js";
import { config } from "../src/lib/config.js";
import type { StripePaymentProvider } from "../src/lib/payments/stripeProvider.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan, setSubscriptionStatus } from "./helpers.js";
import { createSession } from "../src/modules/auth/auth.service.js";

// PROGRAM 3 / Invoicing I8: Stripe Connect invoice payments + derived state.

let checkoutEvent: Stripe.Event;
const provider: StripePaymentProvider = {
  createConnectedAccount: async () => "acct_test_business",
  createAccountLink: async () => "https://connect.stripe.test/onboard",
  getAccountStatus: async () => ({ chargesEnabled: true, detailsSubmitted: true, payoutsEnabled: true }),
  createCheckout: async (input) => ({ sessionId: `cs_${input.transactionId}`, url: "https://checkout.stripe.test/session" }),
  createRefund: async (input) => ({ id: "re_test", amount: input.amountMinor ?? 0, status: "succeeded" }),
  constructEvent: () => checkoutEvent,
};

const auth = authHeader;

async function businessAccount(app: FastifyInstance, plan: "FREE" | "PRO" | "BUSINESS" = "BUSINESS") {
  const account = await registerAccount(app);
  await setPlan(account.businessId, plan);
  if (plan !== "FREE") await setSubscriptionStatus(account.businessId, "ACTIVE");
  await prisma.business.update({ where: { id: account.businessId }, data: { currency: "USD", stripeAccountId: "acct_test_business" } });
  return account;
}

async function addMember(app: FastifyInstance, businessId: string, role: "ADMIN" | "STAFF") {
  const email = `m-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const user = await prisma.user.create({ data: { email, normalizedEmail: email.toLowerCase(), fullName: role, passwordHash: null } });
  await prisma.businessMember.create({ data: { businessId, userId: user.id, role, status: "ACTIVE" } });
  const { session } = await createSession(user.id, prisma);
  return app.jwt.sign({ userId: user.id, sessionId: session.id, type: "access" }, { expiresIn: 900 });
}

async function sentInvoice(app: FastifyInstance, token: string, over: Record<string, unknown> = {}) {
  const draftRes = await app.inject({
    method: "POST",
    url: "/invoices",
    headers: auth(token),
    payload: { lineItems: [{ description: "Consulting", quantity: 2, unitPrice: "75.00", discountAmount: "10.00" }], ...over },
  });
  if (draftRes.statusCode !== 201) throw new Error(`draft failed: ${draftRes.body}`);
  const draft = draftRes.json();
  const sendRes = await app.inject({ method: "POST", url: `/invoices/${draft.id}/send`, headers: auth(token) });
  if (sendRes.statusCode !== 200) throw new Error(`send failed: ${sendRes.body}`);
  return draft;
}

function paidEvent(transaction: { id: string; stripeCheckoutSessionId: string | null }, amountMinor: number): Stripe.Event {
  return {
    id: "evt_paid",
    object: "event",
    api_version: null,
    created: 0,
    livemode: false,
    pending_webhooks: 0,
    request: null,
    type: "checkout.session.completed",
    account: "acct_test_business",
    data: {
      object: {
        id: transaction.stripeCheckoutSessionId,
        object: "checkout.session",
        payment_status: "paid",
        amount_total: amountMinor,
        currency: "usd",
        payment_intent: "pi_test",
        metadata: { chakusaTransactionId: transaction.id, chakusaInvoiceId: "present" },
      } as unknown as Stripe.Checkout.Session,
    },
  } as Stripe.Event;
}

describe("Stripe Connect invoice payments (Program 3, Invoicing I8)", () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    config.STRIPE_PAYMENTS_ENABLED = true;
    app = await createTestApp({ stripePaymentProvider: provider });
  });
  afterEach(resetDatabase);
  afterAll(async () => {
    config.STRIPE_PAYMENTS_ENABLED = false;
    await app.close();
    await prisma.$disconnect();
  });

  it("collects a verified full payment and derives PAID with a zero outstanding balance", async () => {
    const account = await businessAccount(app);
    const invoice = await sentInvoice(app, account.token, { dueDate: "2999-01-01" });

    const link = await app.inject({ method: "POST", url: `/invoices/${invoice.id}/payment-link`, headers: auth(account.token) });
    expect(link.statusCode).toBe(201);
    expect(link.json()).toMatchObject({ amount: "140", currency: "USD", status: "pending", checkoutUrl: "https://checkout.stripe.test/session" });

    const txn = await prisma.invoicePaymentTransaction.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    checkoutEvent = paidEvent(txn, 14000);
    expect((await app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "stripe-signature": "ok" }, payload: {} })).statusCode).toBe(200);

    expect((await prisma.invoicePaymentTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("paid");
    const detail = await app.inject({ method: "GET", url: `/invoices/${invoice.id}`, headers: auth(account.token) });
    expect(detail.json().payment).toMatchObject({ amountPaid: "140.00", outstandingBalance: "0.00", state: "PAID" });
  });

  it("is idempotent - a retried paid webhook never double-counts", async () => {
    const account = await businessAccount(app);
    const invoice = await sentInvoice(app, account.token, { dueDate: "2999-01-01" });
    await app.inject({ method: "POST", url: `/invoices/${invoice.id}/payment-link`, headers: auth(account.token) });
    const txn = await prisma.invoicePaymentTransaction.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    checkoutEvent = paidEvent(txn, 14000);
    await app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "stripe-signature": "ok" }, payload: {} });
    await app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "stripe-signature": "ok" }, payload: {} });
    const detail = await app.inject({ method: "GET", url: `/invoices/${invoice.id}`, headers: auth(account.token) });
    expect(detail.json().payment).toMatchObject({ amountPaid: "140.00", state: "PAID" });
    expect(await prisma.invoicePaymentTransaction.count({ where: { invoiceId: invoice.id, status: "paid" } })).toBe(1);
  });

  it("rejects a webhook whose amount does not match the Chakusa record", async () => {
    const account = await businessAccount(app);
    const invoice = await sentInvoice(app, account.token, { dueDate: "2999-01-01" });
    await app.inject({ method: "POST", url: `/invoices/${invoice.id}/payment-link`, headers: auth(account.token) });
    const txn = await prisma.invoicePaymentTransaction.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    checkoutEvent = paidEvent(txn, 999);
    const res = await app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "stripe-signature": "ok" }, payload: {} });
    expect(res.statusCode).toBe(400);
    expect((await prisma.invoicePaymentTransaction.findUniqueOrThrow({ where: { id: txn.id } })).status).toBe("pending");
  });

  it("refunds a settled payment and the derived state falls back to PARTIALLY_PAID", async () => {
    const account = await businessAccount(app);
    const invoice = await sentInvoice(app, account.token, { dueDate: "2999-01-01" });
    await app.inject({ method: "POST", url: `/invoices/${invoice.id}/payment-link`, headers: auth(account.token) });
    const txn = await prisma.invoicePaymentTransaction.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    checkoutEvent = paidEvent(txn, 14000);
    await app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "stripe-signature": "ok" }, payload: {} });

    const refund = await app.inject({ method: "POST", url: `/invoices/${invoice.id}/payments/${txn.id}/refund`, headers: auth(account.token), payload: { amount: 40 } });
    expect(refund.statusCode).toBe(200);
    expect(refund.json()).toMatchObject({ status: "partially_refunded", refundedAmount: "40" });

    const detail = await app.inject({ method: "GET", url: `/invoices/${invoice.id}`, headers: auth(account.token) });
    expect(detail.json().payment).toMatchObject({ amountRefunded: "40.00", outstandingBalance: "40.00", state: "PARTIALLY_PAID" });
  });

  it("STAFF may create a payment link but only OWNER/ADMIN may refund", async () => {
    const account = await businessAccount(app);
    const staff = await addMember(app, account.businessId, "STAFF");
    const admin = await addMember(app, account.businessId, "ADMIN");
    const invoice = await sentInvoice(app, account.token, { dueDate: "2999-01-01" });

    const staffLink = await app.inject({ method: "POST", url: `/invoices/${invoice.id}/payment-link`, headers: auth(staff) });
    expect(staffLink.statusCode).toBe(201);
    const txn = await prisma.invoicePaymentTransaction.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    checkoutEvent = paidEvent(txn, 14000);
    await app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "stripe-signature": "ok" }, payload: {} });

    const staffRefund = await app.inject({ method: "POST", url: `/invoices/${invoice.id}/payments/${txn.id}/refund`, headers: auth(staff), payload: { amount: 10 } });
    expect(staffRefund.statusCode).toBe(403);
    const adminRefund = await app.inject({ method: "POST", url: `/invoices/${invoice.id}/payments/${txn.id}/refund`, headers: auth(admin), payload: { amount: 10 } });
    expect(adminRefund.statusCode).toBe(200);
  });

  it("rejects a payment link for a DRAFT or a VOID invoice", async () => {
    const account = await businessAccount(app);
    const draftRes = await app.inject({ method: "POST", url: "/invoices", headers: auth(account.token), payload: { lineItems: [{ description: "x", quantity: 1, unitPrice: "10.00" }] } });
    const draftId = draftRes.json().id;
    expect((await app.inject({ method: "POST", url: `/invoices/${draftId}/payment-link`, headers: auth(account.token) })).statusCode).toBe(409);

    const invoice = await sentInvoice(app, account.token);
    await app.inject({ method: "POST", url: `/invoices/${invoice.id}/void`, headers: auth(account.token) });
    expect((await app.inject({ method: "POST", url: `/invoices/${invoice.id}/payment-link`, headers: auth(account.token) })).statusCode).toBe(409);
  });

  it("rejects a second payment link once the invoice is fully paid", async () => {
    const account = await businessAccount(app);
    const invoice = await sentInvoice(app, account.token, { dueDate: "2999-01-01" });
    await app.inject({ method: "POST", url: `/invoices/${invoice.id}/payment-link`, headers: auth(account.token) });
    const txn = await prisma.invoicePaymentTransaction.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    checkoutEvent = paidEvent(txn, 14000);
    await app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "stripe-signature": "ok" }, payload: {} });
    const second = await app.inject({ method: "POST", url: `/invoices/${invoice.id}/payment-link`, headers: auth(account.token) });
    expect(second.statusCode).toBe(409);
  });

  it("returns 403 for FREE / PRO plans and 401 for an unauthenticated caller", async () => {
    const free = await businessAccount(app, "FREE");
    const invoiceFree = await prisma.invoice.create({ data: { businessId: free.businessId, createdByMemberId: (await prisma.businessMember.findFirstOrThrow({ where: { businessId: free.businessId } })).id, invoiceNumber: "INV-2026-9999", currency: "USD", status: "SENT", nextRevisionNumber: 2 } });
    const res = await app.inject({ method: "POST", url: `/invoices/${invoiceFree.id}/payment-link`, headers: auth(free.token) });
    expect(res.statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/invoices/${invoiceFree.id}/payment-link` })).statusCode).toBe(401);
  });

  it("derives OVERDUE for a past-due SENT invoice with no payment", async () => {
    const account = await businessAccount(app);
    const invoice = await sentInvoice(app, account.token, { issueDate: "2026-01-01", dueDate: "2026-01-15" });
    const detail = await app.inject({ method: "GET", url: `/invoices/${invoice.id}`, headers: auth(account.token) });
    expect(detail.json().payment.state).toBe("OVERDUE");
  });

  it("exposes authoritative outstanding balance on the public secure link", async () => {
    const account = await businessAccount(app);
    const draftRes = await app.inject({ method: "POST", url: "/invoices", headers: auth(account.token), payload: { lineItems: [{ description: "Consulting", quantity: 2, unitPrice: "75.00", discountAmount: "10.00" }], dueDate: "2999-01-01" } });
    const draft = draftRes.json();
    const sendRes = await app.inject({ method: "POST", url: `/invoices/${draft.id}/send`, headers: auth(account.token) });
    const rawToken = (sendRes.json().accessUrl as string).split("/i/")[1];

    const pub = await app.inject({ method: "GET", url: `/public/invoices/${rawToken}` });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().payment).toMatchObject({ outstandingBalance: "140.00", state: null });
    expect(JSON.stringify(pub.json())).not.toContain("stripe");
  });
});
