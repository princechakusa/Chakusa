import type { FastifyInstance } from "fastify";
import { ApiError } from "../../lib/errors.js";
import { resolvePublicQuoteToken, serializePublicQuote } from "./publicQuotes.service.js";

/**
 * PROGRAM 3 LOOP 3D: unauthenticated, customer-facing quote view. No
 * fastify.authenticate / requireBusiness hook - authorization is the
 * revision-bound bearer token alone (see publicQuotes.service.ts and
 * public.routes.ts's doc comment for the shared discipline).
 *
 * Read-only. Accept / decline is a separate stage (3E); this route has no
 * side effects and records no events.
 */
export default async function publicQuoteRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { token: string } }>(
    "/:token",
    // A customer may reasonably reload the link a few times; 30/min per IP
    // absorbs that while bounding brute-force token-guessing traffic.
    // Matches the public-review GET limit.
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const resolved = await resolvePublicQuoteToken(request.params.token);
      if (!resolved) {
        throw ApiError.notFound("This link is invalid or no longer available");
      }
      reply.send(serializePublicQuote(resolved));
    },
  );
}
