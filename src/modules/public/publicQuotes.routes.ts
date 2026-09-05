import type { FastifyInstance } from "fastify";
import { ApiError } from "../../lib/errors.js";
import { resolvePublicQuoteToken, serializePublicQuote, type PublicQuoteState } from "./publicQuotes.service.js";
import { decidePublicQuote } from "./publicQuoteActions.service.js";
import { publicQuoteDecisionSchema } from "./publicQuotes.schemas.js";

/**
 * PROGRAM 3 LOOP 3D + 3E: unauthenticated, customer-facing quote access.
 * No fastify.authenticate / requireBusiness hook - authorization is the
 * revision-bound bearer token alone (see publicQuotes.service.ts and
 * public.routes.ts's doc comment for the shared discipline).
 *
 *   GET  /:token          -> read the bound revision (Loop 3D, read-only)
 *   POST /:token/accept    -> SENT -> ACCEPTED (Loop 3E)
 *   POST /:token/decline   -> SENT -> DECLINED (Loop 3E)
 */

const NOT_OPEN_MESSAGE: Record<Exclude<PublicQuoteState, "open">, string> = {
  accepted: "This quote has already been accepted",
  declined: "This quote has already been declined",
  canceled: "This quote is no longer available",
  expired: "This quote has expired and can no longer be actioned",
};

export default async function publicQuoteRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { token: string } }>(
    "/:token",
    // A customer may reasonably reload the link a few times; 30/min per IP
    // absorbs that while bounding brute-force token-guessing traffic.
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const resolved = await resolvePublicQuoteToken(request.params.token);
      if (!resolved) {
        throw ApiError.notFound("This link is invalid or no longer available");
      }
      reply.send(serializePublicQuote(resolved));
    },
  );

  for (const decision of ["accept", "decline"] as const) {
    fastify.post<{ Params: { token: string } }>(
      `/:token/${decision}`,
      // A real customer acts once; 10/min per IP still allows a genuine
      // retry after a network hiccup. Matches the public-review feedback POST.
      { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const input = publicQuoteDecisionSchema.parse(request.body ?? {});
        const result = await decidePublicQuote(request.params.token, decision, input);
        if (!result) {
          throw ApiError.notFound("This link is invalid or no longer available");
        }
        if (result.outcome === "not_open") {
          throw ApiError.conflict(NOT_OPEN_MESSAGE[result.state]);
        }
        reply.send(result.quote);
      },
    );
  }
}
