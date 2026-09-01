import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiError } from "../../lib/errors.js";
import { LEGAL_DOCUMENT_TYPES, getCurrentPublishedVersion } from "../../lib/legal/legalDocuments.service.js";

// PROGRAM 2 LOOP 4: unauthenticated on purpose, a prospective user (or the
// website itself) needs to read the current Terms/Privacy before ever
// creating an account. No preHandler hook on this file.
export default async function legalRoutes(fastify: FastifyInstance) {
  fastify.get("/documents/:type", async (request, reply) => {
    const { type } = z.object({ type: z.enum(LEGAL_DOCUMENT_TYPES) }).parse(request.params);
    const version = await getCurrentPublishedVersion(type);
    if (!version) throw ApiError.notFound(`No published ${type} exists yet`);
    reply.send({
      type: version.type,
      version: version.version,
      title: version.title,
      content: version.content,
      summary: version.summary,
      effectiveAt: version.effectiveAt,
      publishedAt: version.publishedAt,
    });
  });
}
