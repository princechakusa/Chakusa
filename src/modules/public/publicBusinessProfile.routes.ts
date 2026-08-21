import type { FastifyInstance } from "fastify";
import { ApiError } from "../../lib/errors.js";
import { submitPublicContactSchema } from "./public.schemas.js";
import { resolvePublicBusinessProfile, submitPublicContactForm } from "./publicBusinessProfile.service.js";

/**
 * Unauthenticated, permanent-link routes for a business's public profile
 * page — see the schema comment on Business.publicSlug. Same rate-limit and
 * minimal-exposure discipline as public.routes.ts.
 */
export default async function publicBusinessProfileRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { slug: string } }>(
    "/:slug",
    // A shared/bookmarked business page reasonably reloads often; 30/min per
    // IP absorbs that while still bounding slug-enumeration traffic.
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const profile = await resolvePublicBusinessProfile(request.params.slug);
      if (!profile) {
        throw ApiError.notFound("This business page is invalid or no longer available");
      }
      reply.send(profile);
    },
  );

  fastify.post<{ Params: { slug: string } }>(
    "/:slug/contact",
    // A genuine customer submits once; 10/min per IP still allows a retry
    // after a network hiccup without meaningfully opening the door to abuse.
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = submitPublicContactSchema.parse(request.body);
      const result = await submitPublicContactForm(request.params.slug, input);
      if (!result) {
        throw ApiError.notFound("This business page is invalid or no longer available");
      }
      reply.status(201).send({ state: "submitted", businessName: result.businessName });
    },
  );
}
