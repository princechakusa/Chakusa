import type { FastifyInstance } from "fastify";
import { ApiError } from "../../lib/errors.js";
import { resolvePublicInvoiceToken, serializePublicInvoice } from "./publicInvoices.service.js";
import { payInvoiceViaToken } from "../invoices/invoicePayments.service.js";
import { defaultStripePaymentProvider, type StripePaymentProvider } from "../../lib/payments/stripeProvider.js";

/**
 * PROGRAM 3 / Invoicing I4 + I8: unauthenticated, customer-facing invoice
 * view and pay. No fastify.authenticate / requireBusiness hook -
 * authorization is the bearer token alone (see publicInvoices.service.ts
 * and public.routes.ts's doc comment for the shared discipline). The GET
 * is read-only; the pay action only ever starts a Stripe Checkout Session
 * for the invoice the token is bound to.
 */
export interface PublicInvoiceRoutesOptions {
  provider?: StripePaymentProvider;
}

export default async function publicInvoiceRoutes(fastify: FastifyInstance, options: PublicInvoiceRoutesOptions = {}) {
  const provider = options.provider ?? defaultStripePaymentProvider;

  fastify.get<{ Params: { token: string } }>(
    "/:token",
    // A customer may reasonably reload the link a few times; 30/min per IP
    // absorbs that while bounding brute-force token-guessing traffic.
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const resolved = await resolvePublicInvoiceToken(request.params.token);
      if (!resolved) {
        throw ApiError.notFound("This link is invalid or no longer available");
      }
      reply.send(serializePublicInvoice(resolved));
    },
  );

  // I8: start a payment for the invoice this token is bound to. Tighter
  // rate limit than the read - a pay attempt is never a page refresh.
  fastify.post<{ Params: { token: string } }>(
    "/:token/pay",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      reply.status(201).send(await payInvoiceViaToken(request.params.token, provider));
    },
  );
}
