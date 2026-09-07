import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getCustomerInvoiceForProfile, listCustomerInvoices } from "./invoices.service.js";

// PROGRAM 3 / Invoicing I7 — authenticated customer invoice inbox.
// authenticateCustomer only; every handler is scoped to
// request.customer.profileId. Read-only: a customer never mutates an
// invoice. DRAFT invoices are never returned (see invoices.service.ts).

const idParam = z.object({ id: z.string().uuid() });

export default async function customerInvoiceRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticateCustomer);

  fastify.get("/", async (request) => listCustomerInvoices(request.customer!.profileId));

  fastify.get<{ Params: { id: string } }>("/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    return getCustomerInvoiceForProfile(request.customer!.profileId, id);
  });
}
