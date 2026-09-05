import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { requireBusinessRole } from "../../lib/authorization.js";
import { assertFeatureAvailable } from "../../lib/entitlements.js";
import { createQuoteSchema, updateQuoteSchema, listQuotesQuerySchema, quoteIdParamSchema, sendQuoteSchema } from "./quotes.schemas.js";
import { createQuoteDraft, updateQuoteDraft, deleteQuoteDraft, listQuotes, getQuoteDetail, sendQuote, cancelQuote, reviseQuote, resendQuote } from "./quotes.service.js";

// PROGRAM 3 LOOP 3B: BUSINESS-facing draft + read API for Quotes &
// Estimates. Route handlers do ONLY: auth (preHandler) -> validation ->
// authorization -> entitlement -> service call -> response. All business
// logic (numbering, revisioning, money, tenant scoping) lives in
// quotes.service.ts / the Loop 3A domain layer.
//
// Locked v1 permission policy: OWNER, ADMIN and STAFF may all view,
// create, edit and delete DRAFT documents — there is no narrower gate.
// This explicit allow-list still exists so that a future BusinessRole
// added to the enum is NOT silently granted access.
const QUOTE_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN", "STAFF"];

// PROGRAM 3 LOOP 3F: canceling a SENT quote is a higher-impact action
// than draft editing - locked policy is OWNER/ADMIN only (STAFF may
// create/edit/send drafts but not retract a document already in front of
// a customer).
const QUOTE_CANCEL_ROLES: readonly BusinessRole[] = ["OWNER", "ADMIN"];

async function resolveMemberId(businessId: string, userId: string): Promise<string> {
  const member = await prisma.businessMember.findFirst({ where: { businessId, userId }, select: { id: true } });
  // requireBusiness already proved this user is a member of this business;
  // a miss here would be an invariant violation, not a client error.
  if (!member) throw ApiError.forbidden("You do not have permission to perform this action");
  return member.id;
}

export default async function quoteRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/", async (request, reply) => {
    requireBusinessRole(request, QUOTE_ROLES);
    assertFeatureAvailable(request.plan!, "QUOTES_ESTIMATES");
    const query = listQuotesQuerySchema.parse(request.query);
    reply.send(await listQuotes(request.businessId!, query));
  });

  fastify.post("/", async (request, reply) => {
    requireBusinessRole(request, QUOTE_ROLES);
    assertFeatureAvailable(request.plan!, "QUOTES_ESTIMATES");
    const input = createQuoteSchema.parse(request.body);
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.status(201).send(await createQuoteDraft(request.businessId!, memberId, input));
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    requireBusinessRole(request, QUOTE_ROLES);
    assertFeatureAvailable(request.plan!, "QUOTES_ESTIMATES");
    const { id } = quoteIdParamSchema.parse(request.params);
    reply.send(await getQuoteDetail(request.businessId!, id));
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    requireBusinessRole(request, QUOTE_ROLES);
    assertFeatureAvailable(request.plan!, "QUOTES_ESTIMATES");
    const { id } = quoteIdParamSchema.parse(request.params);
    const input = updateQuoteSchema.parse(request.body);
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.send(await updateQuoteDraft(request.businessId!, memberId, id, input));
  });

  fastify.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    requireBusinessRole(request, QUOTE_ROLES);
    assertFeatureAvailable(request.plan!, "QUOTES_ESTIMATES");
    const { id } = quoteIdParamSchema.parse(request.params);
    await deleteQuoteDraft(request.businessId!, id);
    reply.status(204).send();
  });

  // PROGRAM 3 LOOP 3C: DRAFT -> SENT. Same pipeline as every route above.
  // The successful response carries the raw acceptance token exactly once
  // (for a future delivery/customer-access stage); it is never persisted
  // or logged and never appears in any GET response.
  fastify.post<{ Params: { id: string } }>("/:id/send", async (request, reply) => {
    requireBusinessRole(request, QUOTE_ROLES);
    assertFeatureAvailable(request.plan!, "QUOTES_ESTIMATES");
    const { id } = quoteIdParamSchema.parse(request.params);
    const input = sendQuoteSchema.parse(request.body ?? {});
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.status(200).send(await sendQuote(request.businessId!, memberId, id, input));
  });

  // PROGRAM 3 LOOP 3F: SENT -> CANCELED. OWNER/ADMIN only. Revokes every
  // live acceptance token so the customer link can no longer accept.
  fastify.post<{ Params: { id: string } }>("/:id/cancel", async (request, reply) => {
    requireBusinessRole(request, QUOTE_CANCEL_ROLES);
    assertFeatureAvailable(request.plan!, "QUOTES_ESTIMATES");
    const { id } = quoteIdParamSchema.parse(request.params);
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.status(200).send(await cancelQuote(request.businessId!, memberId, id));
  });

  // PROGRAM 3 LOOP 3F: SENT -> SENT with a new immutable current revision.
  // OWNER/ADMIN only (editing a document the customer has already seen).
  // Revokes the old revision's token and returns a fresh one for the new
  // revision, exactly once, for re-delivery.
  fastify.post<{ Params: { id: string } }>("/:id/revise", async (request, reply) => {
    requireBusinessRole(request, QUOTE_CANCEL_ROLES);
    assertFeatureAvailable(request.plan!, "QUOTES_ESTIMATES");
    const { id } = quoteIdParamSchema.parse(request.params);
    const input = updateQuoteSchema.parse(request.body);
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.status(200).send(await reviseQuote(request.businessId!, memberId, id, input));
  });

  // PROGRAM 3 LOOP 3G: re-issue the customer link for a SENT quote (same
  // current revision, no lifecycle change). OWNER/ADMIN/STAFF - same as
  // send. Response carries the fresh raw token + assembled acceptanceUrl.
  fastify.post<{ Params: { id: string } }>("/:id/resend", async (request, reply) => {
    requireBusinessRole(request, QUOTE_ROLES);
    assertFeatureAvailable(request.plan!, "QUOTES_ESTIMATES");
    const { id } = quoteIdParamSchema.parse(request.params);
    const memberId = await resolveMemberId(request.businessId!, request.user.userId);
    reply.status(200).send(await resendQuote(request.businessId!, memberId, id));
  });
}
