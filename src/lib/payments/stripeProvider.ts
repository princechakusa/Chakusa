import Stripe from "stripe";
import { config } from "../config.js";

export interface StripePaymentProvider {
  createConnectedAccount(input: {
    businessId: string;
    businessName: string;
    country?: string | null;
  }): Promise<string>;
  createAccountLink(accountId: string): Promise<string>;
  getAccountStatus(
    accountId: string,
  ): Promise<{
    chargesEnabled: boolean;
    detailsSubmitted: boolean;
    payoutsEnabled: boolean;
  }>;
  createCheckout(input: {
    accountId: string;
    transactionId: string;
    appointmentId: string;
    businessId: string;
    label: string;
    amountMinor: number;
    currency: string;
    customerEmail?: string | null;
  }): Promise<{ sessionId: string; url: string }>;
  createRefund(input: {
    accountId: string;
    paymentIntentId: string;
    amountMinor?: number;
  }): Promise<{ id: string; amount: number; status: string | null }>;
  constructEvent(rawBody: Buffer, signature: string): Stripe.Event;
}

export class StripeSdkPaymentProvider implements StripePaymentProvider {
  private readonly client: Stripe;
  constructor(
    client = new Stripe(config.STRIPE_SECRET_KEY || "sk_test_unconfigured"),
  ) {
    this.client = client;
  }
  async createConnectedAccount(input: {
    businessId: string;
    businessName: string;
    country?: string | null;
  }) {
    const account = await this.client.accounts.create({
      type: "express",
      business_profile: { name: input.businessName },
      country: input.country ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { chakusaBusinessId: input.businessId },
    });
    return account.id;
  }
  async createAccountLink(accountId: string) {
    const link = await this.client.accountLinks.create({
      account: accountId,
      type: "account_onboarding",
      return_url: config.STRIPE_CONNECT_RETURN_URL!,
      refresh_url: config.STRIPE_CONNECT_REFRESH_URL!,
    });
    return link.url;
  }
  async getAccountStatus(accountId: string) {
    const account = await this.client.accounts.retrieve(accountId);
    return {
      chargesEnabled: account.charges_enabled,
      detailsSubmitted: account.details_submitted,
      payoutsEnabled: account.payouts_enabled,
    };
  }
  async createCheckout(input: {
    accountId: string;
    transactionId: string;
    appointmentId: string;
    businessId: string;
    label: string;
    amountMinor: number;
    currency: string;
    customerEmail?: string | null;
  }) {
    const session = await this.client.checkout.sessions.create(
      {
        mode: "payment",
        success_url: `${config.STRIPE_CHECKOUT_SUCCESS_URL!}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: config.STRIPE_CHECKOUT_CANCEL_URL!,
        customer_email: input.customerEmail ?? undefined,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.currency.toLowerCase(),
              unit_amount: input.amountMinor,
              product_data: { name: input.label },
            },
          },
        ],
        metadata: {
          chakusaTransactionId: input.transactionId,
          chakusaAppointmentId: input.appointmentId,
          chakusaBusinessId: input.businessId,
        },
        payment_intent_data: {
          metadata: {
            chakusaTransactionId: input.transactionId,
            chakusaAppointmentId: input.appointmentId,
            chakusaBusinessId: input.businessId,
          },
        },
      },
      { stripeAccount: input.accountId, idempotencyKey: input.transactionId },
    );
    if (!session.url) throw new Error("Stripe did not return a Checkout URL");
    return { sessionId: session.id, url: session.url };
  }
  async createRefund(input: {
    accountId: string;
    paymentIntentId: string;
    amountMinor?: number;
  }) {
    const refund = await this.client.refunds.create(
      { payment_intent: input.paymentIntentId, amount: input.amountMinor },
      { stripeAccount: input.accountId },
    );
    return { id: refund.id, amount: refund.amount, status: refund.status };
  }
  constructEvent(rawBody: Buffer, signature: string) {
    return this.client.webhooks.constructEvent(
      rawBody,
      signature,
      config.STRIPE_WEBHOOK_SECRET!,
    );
  }
}

export const defaultStripePaymentProvider = new StripeSdkPaymentProvider();
