import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getCustomerInvoiceForProfile, listCustomerInvoices } from "./invoices.service.js";
import { payInvoiceForCustomer } from "../invoices/invoicePayments.service.js";
import { defaultStripePaymentProvider, type StripePaymentProvider } from "../../lib/payments/stripeProvider.js";

// PROGRAM 3 / Invoicing I7 + I8 — authenticated customer invoice inbox.
// authenticateCustomer only; every handler is scoped to
// request.customer.profileId. Read-only except "pay", which only ever
// starts a Stripe Checkout Session for an invoice the customer owns.
// DRAFT invoices are never returned (see invoices.service.ts).

const idParam = z.object({ id: z.string().uuid() });

export interface CustomerInvoiceRoutesOptions {
  provider?: StripePaymentProvider;
}

export default async function customerInvoiceRoutes(fastify: FastifyInstance, options: CustomerInvoiceRoutesOptions = {}) {
  const provider = options.provider ?? defaultStripePaymentProvider;
  fastify.addHook("preHandler", fastify.authenticateCustomer);

  fastify.get("/", async (request) => listCustomerInvoices(request.customer!.profileId));

  fastify.get<{ Params: { id: string } }>("/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    return getCustomerInvoiceForProfile(request.customer!.profileId, id);
  });

  fastify.post<{ Params: { id: string } }>("/:id/pay", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    reply.status(201).send(await payInvoiceForCustomer(request.customer!.profileId, id, provider));
  });
}
