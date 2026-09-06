import type { FastifyInstance } from "fastify";
import { ApiError } from "../../lib/errors.js";
import { resolvePublicInvoiceToken, serializePublicInvoice } from "./publicInvoices.service.js";

/**
 * PROGRAM 3 / Invoicing I4: unauthenticated, customer-facing invoice
 * view. No fastify.authenticate / requireBusiness hook - authorization
 * is the bearer token alone (see publicInvoices.service.ts and
 * public.routes.ts's doc comment for the shared discipline). Read-only.
 */
export default async function publicInvoiceRoutes(fastify: FastifyInstance) {
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
}
