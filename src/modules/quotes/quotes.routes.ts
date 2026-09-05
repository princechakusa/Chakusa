import type { FastifyInstance } from "fastify";
import type { BusinessRole } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { requireBusinessRole } from "../../lib/authorization.js";
import { assertFeatureAvailable } from "../../lib/entitlements.js";
import { createQuoteSchema, updateQuoteSchema, listQuotesQuerySchema, quoteIdParamSchema } from "./quotes.schemas.js";
import { createQuoteDraft, updateQuoteDraft, deleteQuoteDraft, listQuotes, getQuoteDetail } from "./quotes.service.js";

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
}
