import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

// PROGRAM 2 LOOP 1: the Customer Platform's authentication guard. It reuses
// the same JWT + AuthSession machinery as `authenticate`, but requires a
// CUSTOMER-scoped session and an ACTIVE CustomerProfile — a business
// (PRODUCT) or admin token can never satisfy it, and vice versa.

export interface CustomerIdentity {
  userId: string;
  sessionId: string;
  profileId: string;
  status: string;
  preferredLanguage: string;
  preferredTimezone: string;
}

declare module "fastify" {
  interface FastifyRequest {
    customer?: CustomerIdentity;
  }
  interface FastifyInstance {
    authenticateCustomer: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function customerAuthPlugin(fastify: FastifyInstance) {
  fastify.decorate("authenticateCustomer", async function (request: FastifyRequest) {
    try {
      await request.jwtVerify();
    } catch {
      throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid or expired access token");
    }
    if (request.user.type !== "access" || !request.user.sessionId) {
      throw ApiError.auth(401, "AUTH_TOKEN_INVALID", "Invalid access token");
    }
    const session = await prisma.authSession.findFirst({
      where: {
        id: request.user.sessionId,
        userId: request.user.userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        scope: "CUSTOMER",
      },
      select: { id: true, user: { select: { accountStatus: true, customerProfile: { select: { id: true, status: true, preferredLanguage: true, preferredTimezone: true } } } } },
    });
    if (!session) throw ApiError.auth(401, "AUTH_SESSION_EXPIRED", "Authentication session expired");
    if (session.user.accountStatus === "DISABLED") throw ApiError.auth(403, "AUTH_ACCOUNT_DISABLED", "This account has been disabled");
    const profile = session.user.customerProfile;
    if (!profile) throw ApiError.forbidden("This account is not a customer account");
    if (profile.status !== "ACTIVE") throw ApiError.auth(403, "AUTH_ACCOUNT_DISABLED", "This customer account is not active");
    request.customer = {
      userId: request.user.userId,
      sessionId: session.id,
      profileId: profile.id,
      status: profile.status,
      preferredLanguage: profile.preferredLanguage,
      preferredTimezone: profile.preferredTimezone,
    };
  });
});
