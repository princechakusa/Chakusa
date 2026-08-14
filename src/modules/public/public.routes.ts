import type { FastifyInstance } from "fastify";
import { ApiError } from "../../lib/errors.js";
import { submitPublicFeedbackSchema } from "./public.schemas.js";
import {
  resolvePublicReviewToken,
  markPublicReviewOpened,
  submitPublicFeedback,
  serializeOpenOrSubmittedReview,
} from "./publicReviews.service.js";

/**
 * Unauthenticated, customer-facing routes — no fastify.authenticate or
 * requireBusiness hook. Every response is derived entirely from the
 * token; nothing here ever accepts businessId/customerId/reviewRequestId
 * from the client as authorization (see publicReviews.service.ts).
 *
 * Rate limits are tighter than the app-wide default (200/min) and
 * per-route, using @fastify/rate-limit's standard per-route config — no
 * new plugin or custom keyGenerator needed. Both inherit the app's
 * `trustProxy` setting (see src/app.ts / config.ts's TRUST_PROXY), so
 * request.ip already resolves correctly behind a reverse proxy once that
 * flag is enabled in production.
 */
export default async function publicReviewRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { token: string } }>(
    "/:token",
    // A customer may reasonably reload or reopen the same link several
    // times; 30/min per IP absorbs that while still bounding brute-force
    // token-guessing traffic.
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const resolved = await resolvePublicReviewToken(request.params.token);
      if (!resolved) {
        throw ApiError.notFound("This link is invalid or no longer available");
      }

      if (resolved.state === "expired") {
        // No business/service info leaks for an expired link — see the
        // Phase report's "no data leakage" note.
        reply.send({ state: "expired" });
        return;
      }

      if (resolved.state === "open") {
        await markPublicReviewOpened(resolved.reviewRequest);
      }

      reply.send(serializeOpenOrSubmittedReview(resolved.reviewRequest, resolved.state === "open" ? "open" : "submitted"));
    },
  );

  fastify.post<{ Params: { token: string } }>(
    "/:token/feedback",
    // A real customer submits once; 10/min per IP still allows a genuine
    // retry after a network hiccup without meaningfully opening the door
    // to abuse.
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = submitPublicFeedbackSchema.parse(request.body);
      const result = await submitPublicFeedback(request.params.token, input);

      if (!result) {
        throw ApiError.notFound("This link is invalid or no longer available");
      }

      if (result.outcome === "expired") {
        reply.send({ state: "expired" });
        return;
      }
      if (result.outcome === "already_submitted") {
        reply.send({ state: "submitted" });
        return;
      }

      reply.status(201).send({ state: "submitted" });
    },
  );
}
