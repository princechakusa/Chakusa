import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/errors.js";

declare module "fastify" {
  interface FastifyRequest {
    businessId?: string;
  }
  interface FastifyInstance {
    requireBusiness: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Resolves the caller's business from their membership rather than trusting
 * any business_id supplied by the client. MVP assumes one business per user;
 * business_members still models multi-membership for future support.
 */
export default fp(async function tenantPlugin(fastify: FastifyInstance) {
  fastify.decorate("requireBusiness", async function (request: FastifyRequest) {
    const userId = request.user?.userId;
    if (!userId) {
      throw ApiError.unauthorized();
    }

    const membership = await prisma.businessMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });

    if (!membership) {
      throw ApiError.forbidden("User is not a member of any business");
    }

    request.businessId = membership.businessId;
  });
});
