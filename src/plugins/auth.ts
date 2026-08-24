import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../lib/config.js";
import { ApiError } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export interface JwtPayload {
  userId: string;
  sessionId: string;
  type: "access";
  scope?: "admin";
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.register(fastifyJwt, { secret: config.JWT_SECRET });

  fastify.decorate("authenticate", async function (request: FastifyRequest) {
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
        scope: "PRODUCT",
      },
      select: { id: true, user: { select: { accountStatus: true } } },
    });
    if (!session) throw ApiError.auth(401, "AUTH_SESSION_EXPIRED", "Authentication session expired");
    if (session.user.accountStatus === "DISABLED") throw ApiError.auth(403, "AUTH_ACCOUNT_DISABLED", "This account has been disabled");
  });
});
