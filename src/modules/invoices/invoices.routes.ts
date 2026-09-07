import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { requireBusinessRole } from "../../lib/authorization.js";
import { assertFeatureAvailable } from "../../lib/entitlements.js";
import { createInvoiceSchema, updateInvoiceSchema, listInvoicesQuerySchema, invoiceIdParamSchema } from "./invoices.schemas.js";
import { createInvoiceDraft, updateInvoiceDraft, deleteInvoiceDraft, listInvoices, getInvoiceDetail, createInvoiceFromQuote, sendInvoice, voidInvoice, reissueInvoiceLink } from "./invoices.service.js";
import { createInvoicePaymentLink, listInvoicePayments, refundInvoicePayment } from "./invoicePayments.service.js";
import { defaultStripePaymentProvider, type StripePaymentProvider } from "../../lib/payments/stripeProvider.js";

// PROGRAM 3 / Invoicing I2: BUSINESS-facing draft + read API. Route
// handlers do ONLY: auth (preHandler) -> role -> entitlement ->
// validation -> service -> response. All business logic (numbering,
// revisioning, money, tenant scoping) lives in invoices.service.ts / the
// I1 domain layer.
//
// OWNER/ADMIN/STAFF may all create / edit / delete DRAFT invoices -
// mirrors the locked Quotes draft policy. An explicit allow-list so a
// future BusinessRole is not silently granted access.
const INVOICE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "STAFF"];
// Voiding an invoice already in front of a customer is higher-impact -
// OWNER/ADMIN only, mirroring the locked quote-cancel policy.
const INVOICE_VOID_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN"];

async function resolveMemberId(businessId: string, userId: string): Promise<string> {
  const member = await prisma.businessMember.findFirst({ where: { businessId, userId }, select: { id: true } });
  if (!member) throw ApiError.forbidden("You do not have permission to perform this action");
  return member.id;
}

export interface InvoiceRoutesOptions {
  provider?: StripePaymentProvider;
}

export default async function invoiceRoutes(fastify: FastifyInstance, options: InvoiceRoutesOptions = {}) {
  const provider = options.provider ?? defaultStripePaymentProvider;
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/", async (request, reply) => {
    requireBusinessRole(request, INVOICE_ROLES);
    assertFeatureAvailable(request.plan!, "INVOICING");
    const query = listInvoicesQuerySchema.parse(request.query);
    reply.send(await listInvoices(request.businessId!, query));
  });

  fastify.post("/", async (request, reply) => {
    requireBusinessRole(request, INVOICE_ROLES);
    assertFeatureAvailable(request.plan!, "INVOICING");
    const input = createInvoiceSchema.parse(request.body);
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.status(201).send(await createInvoiceDraft(request.businessId!, memberId, input));
  });

  // I3: explicit "Create invoice from accepted quote". Copies the exact
  // accepted revision's immutable financial snapshot; one live invoice
  // per quote.
  fastify.post<{ Params: { quoteId: string } }>("/from-quote/:quoteId", async (request, reply) => {
    requireBusinessRole(request, INVOICE_ROLES);
    assertFeatureAvailable(request.plan!, "INVOICING");
    const { quoteId } = z.object({ quoteId: z.string().uuid() }).parse(request.params);
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.status(201).send(await createInvoiceFromQuote(request.businessId!, memberId, quoteId));
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    requireBusinessRole(request, INVOICE_ROLES);
    assertFeatureAvailable(request.plan!, "INVOICING");
    const { id } = invoiceIdParamSchema.parse(request.params);
    reply.send(await getInvoiceDetail(request.businessId!, id));
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    requireBusinessRole(request, INVOICE_ROLES);
    assertFeatureAvailable(request.plan!, "INVOICING");
    const { id } = invoiceIdParamSchema.parse(request.params);
    const input = updateInvoiceSchema.parse(request.body);
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.send(await updateInvoiceDraft(request.businessId!, memberId, id, input));
  });

  fastify.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    requireBusinessRole(request, INVOICE_ROLES);
    assertFeatureAvailable(request.plan!, "INVOICING");
    const { id } = invoiceIdParamSchema.parse(request.params);
    await deleteInvoiceDraft(request.businessId!, id);
    reply.status(204).send();
  });

  // I4: DRAFT -> SENT. Freezes the current revision and issues the
  // one-time raw access token + assembled customer URL.
  fastify.post<{ Params: { id: string } }>("/:id/send", async (request, reply) => {
    requireBusinessRole(request, INVOICE_ROLES);
    assertFeatureAvailable(request.plan!, "INVOICING");
    const { id } = invoiceIdParamSchema.parse(request.params);
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.status(200).send(await sendInvoice(request.businessId!, memberId, id));
  });

  // I4/I5: re-mint the customer link for a SENT invoice (same revision,
  // no lifecycle change). OWNER/ADMIN/STAFF - same as send.
  fastify.post<{ Params: { id: string } }>("/:id/reissue-link", async (request, reply) => {
    requireBusinessRole(request, INVOICE_ROLES);
    assertFeatureAvailable(request.plan!, "INVOICING");
    const { id } = invoiceIdParamSchema.parse(request.params);
    reply.status(200).send(await reissueInvoiceLink(request.businessId!, id));
  });

  // I4: DRAFT|SENT -> VOID (terminal). OWNER/ADMIN only. Revokes every
  // live access token; never erases financial history.
  fastify.post<{ Params: { id: string } }>("/:id/void", async (request, reply) => {
    requireBusinessRole(request, INVOICE_VOID_ROLES);
    assertFeatureAvailable(request.plan!, "INVOICING");
    const { id } = invoiceIdParamSchema.parse(request.params);
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.status(200).send(await voidInvoice(request.businessId!, memberId, id));
  });

  // I8: collect an invoice payment over Stripe Connect. A SENT invoice
  // with an outstanding balance -> a Checkout Session the business hands
  // to the customer (or that the customer reaches from the secure link).
  // Payment STATE is always derived, never stored (locked decision §3).
  fastify.post<{ Params: { id: string } }>("/:id/payment-link", async (request, reply) => {
    requireBusinessRole(request, INVOICE_ROLES);
    assertFeatureAvailable(request.plan!, "INVOICING");
    const { id } = invoiceIdParamSchema.parse(request.params);
    reply.status(201).send(await createInvoicePaymentLink(request.businessId!, id, provider));
  });

  fastify.get<{ Params: { id: string } }>("/:id/payments", async (request, reply) => {
    requireBusinessRole(request, INVOICE_ROLES);
    assertFeatureAvailable(request.plan!, "INVOICING");
    const { id } = invoiceIdParamSchema.parse(request.params);
    reply.send(await listInvoicePayments(request.businessId!, id));
  });

  // Refunding money already collected is OWNER/ADMIN only, matching VOID.
  fastify.post<{ Params: { id: string; paymentId: string } }>("/:id/payments/:paymentId/refund", async (request, reply) => {
    requireBusinessRole(request, INVOICE_VOID_ROLES);
    assertFeatureAvailable(request.plan!, "INVOICING");
    const { id, paymentId } = z.object({ id: z.string().uuid(), paymentId: z.string().uuid() }).parse(request.params);
    const { amount } = z.object({ amount: z.number().positive().max(99_999_999).optional() }).parse(request.body ?? {});
    reply.send(await refundInvoicePayment(request.businessId!, id, paymentId, amount, provider));
  });
}
