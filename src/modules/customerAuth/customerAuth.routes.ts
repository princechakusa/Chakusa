import type { FastifyInstance, FastifyRequest } from "fastify";
import { config } from "../../lib/config.js";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { createAppleChallenge, createPasswordReset, resetPassword, validateAppleChallenge } from "../auth/auth.service.js";
import { verifyGoogleIdToken, type GoogleTokenVerifier } from "../auth/googleVerifier.js";
import { exchangeAppleAuthorizationCode, verifyAppleIdentityToken, type AppleCodeExchanger, type AppleTokenVerifier } from "../auth/appleAuth.js";
import { sendPasswordResetEmail } from "../auth/passwordResetEmail.js";
import { consumeEmailVerification, createEmailVerification } from "../../lib/customer/emailVerification.js";
import {
  customerAppleSignIn,
  customerGoogleSignIn,
  getCustomerAuthContext,
  listCustomerSessions,
  loginCustomer,
  refreshCustomerSession,
  registerCustomer,
  revokeAllCustomerSessions,
  revokeCustomerSession,
} from "./customerAuth.service.js";
import {
  customerAppleSchema,
  customerDeviceSchema,
  customerForgotPasswordSchema,
  customerGoogleSchema,
  customerLoginSchema,
  customerRefreshSchema,
  customerRegisterSchema,
  customerResetPasswordSchema,
  customerVerifyEmailSchema,
} from "./customerAuth.schemas.js";
import { z } from "zod";

export interface CustomerAuthRouteOptions {
  googleTokenVerifier?: GoogleTokenVerifier;
  appleTokenVerifier?: AppleTokenVerifier;
  appleCodeExchanger?: AppleCodeExchanger;
}

const rl = (max: number, timeWindow: string) => ({ config: { rateLimit: { max, timeWindow } } });

export default async function customerAuthRoutes(fastify: FastifyInstance, options: CustomerAuthRouteOptions = {}) {
  const googleTokenVerifier = options.googleTokenVerifier ?? verifyGoogleIdToken;
  const appleTokenVerifier = options.appleTokenVerifier ?? verifyAppleIdentityToken;
  const appleCodeExchanger = options.appleCodeExchanger ?? exchangeAppleAuthorizationCode;

  const attrs = (request: FastifyRequest) => ({ ipAddress: request.ip, userAgent: request.headers["user-agent"] ?? null });
  const session = (userId: string, sessionId: string, refreshToken: string) => {
    const accessToken = fastify.jwt.sign({ userId, sessionId, type: "access" }, { expiresIn: config.ACCESS_TOKEN_TTL_SECONDS });
    return { accessToken, token: accessToken, refreshToken, expiresIn: config.ACCESS_TOKEN_TTL_SECONDS, tokenType: "Bearer" };
  };
  const publicCustomer = (ctx: Awaited<ReturnType<typeof getCustomerAuthContext>>) => ({
    user: ctx.user,
    profile: {
      id: ctx.profile.id,
      displayName: ctx.profile.displayName,
      avatarUrl: ctx.profile.avatarUrl,
      preferredLanguage: ctx.profile.preferredLanguage,
      preferredTimezone: ctx.profile.preferredTimezone,
      status: ctx.profile.status,
      verified: Boolean(ctx.profile.verifiedAt),
    },
  });

  fastify.post("/register", rl(10, "15 minutes"), async (request, reply) => {
    const input = customerRegisterSchema.parse(request.body);
    const result = await registerCustomer({ ...input, attrs: attrs(request) });
    const ctx = await getCustomerAuthContext(result.user.id);
    reply.status(201).send({ ...session(result.user.id, result.session.id, result.refreshToken), ...publicCustomer(ctx), verificationRequired: true });
  });

  fastify.post("/login", rl(20, "15 minutes"), async (request, reply) => {
    const input = customerLoginSchema.parse(request.body);
    const result = await loginCustomer({ ...input, attrs: attrs(request) });
    const ctx = await getCustomerAuthContext(result.user.id);
    reply.send({ ...session(result.user.id, result.session.id, result.refreshToken), ...publicCustomer(ctx) });
  });

  fastify.post("/google", rl(20, "15 minutes"), async (request, reply) => {
    const input = customerGoogleSchema.parse(request.body);
    const identity = await googleTokenVerifier(input.idToken);
    const result = await customerGoogleSignIn(identity, attrs(request));
    const ctx = await getCustomerAuthContext(result.user.id);
    reply.send({ ...session(result.user.id, result.session.id, result.refreshToken), ...publicCustomer(ctx), isNewUser: result.isNewUser });
  });

  fastify.post("/apple/challenge", rl(30, "15 minutes"), async (_request, reply) => reply.send(await createAppleChallenge("APPLE_SIGN_IN")));

  fastify.post("/apple", rl(30, "15 minutes"), async (request, reply) => {
    const input = customerAppleSchema.parse(request.body);
    const proof = { challengeId: input.challengeId, nonce: input.nonce, state: input.state };
    await validateAppleChallenge(proof, "APPLE_SIGN_IN");
    const identity = await appleTokenVerifier(input.identityToken, input.nonce);
    const tokens = await appleCodeExchanger(input.authorizationCode);
    const exchanged = await appleTokenVerifier(tokens.identityToken, input.nonce);
    if (exchanged.providerSubject !== identity.providerSubject || exchanged.email.toLowerCase() !== identity.email.toLowerCase()) {
      throw ApiError.auth(401, "APPLE_CODE_INVALID", "Apple authorization code does not match the presented identity");
    }
    const result = await customerAppleSignIn(identity, tokens.refreshToken, proof, input, attrs(request));
    const ctx = await getCustomerAuthContext(result.user.id);
    reply.send({ ...session(result.user.id, result.session.id, result.refreshToken), ...publicCustomer(ctx), isNewUser: result.isNewUser });
  });

  fastify.post("/refresh", rl(60, "15 minutes"), async (request, reply) => {
    const input = customerRefreshSchema.parse(request.body);
    const rotated = await refreshCustomerSession(input.refreshToken);
    reply.send(session(rotated.session.userId, rotated.session.id, rotated.refreshToken));
  });

  fastify.post("/logout", async (request, reply) => {
    const input = customerRefreshSchema.parse(request.body);
    const parsed = input.refreshToken.split(".")[0];
    if (parsed) await prisma.authSession.updateMany({ where: { id: parsed, scope: "CUSTOMER", revokedAt: null }, data: { revokedAt: new Date(), revokeReason: "customer_logout" } });
    reply.status(204).send();
  });

  fastify.post("/logout-all", { preHandler: fastify.authenticateCustomer }, async (request, reply) => {
    reply.send(await revokeAllCustomerSessions(request.customer!.userId));
  });

  fastify.get("/sessions", { preHandler: fastify.authenticateCustomer }, async (request) => listCustomerSessions(request.customer!.userId));

  fastify.delete("/sessions/:id", { preHandler: fastify.authenticateCustomer }, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await revokeCustomerSession(request.customer!.userId, id);
    reply.status(204).send();
  });

  fastify.post("/forgot-password", rl(5, "15 minutes"), async (request, reply) => {
    const input = customerForgotPasswordSchema.parse(request.body);
    const token = await createPasswordReset(input.email);
    if (token) await sendPasswordResetEmail(input.email, token).catch(() => undefined);
    reply.send({ message: "If an account exists for that email, a reset link has been sent." });
  });

  fastify.post("/reset-password", rl(10, "15 minutes"), async (request, reply) => {
    const input = customerResetPasswordSchema.parse(request.body);
    await resetPassword(input.token, input.password);
    reply.send({ message: "Password updated. Please sign in again." });
  });

  fastify.post("/verify-email", rl(20, "15 minutes"), async (request, reply) => {
    const input = customerVerifyEmailSchema.parse(request.body);
    await consumeEmailVerification(input.token);
    reply.send({ verified: true });
  });

  fastify.post("/resend-verification", { preHandler: fastify.authenticateCustomer }, async (request, reply) => {
    const ctx = await getCustomerAuthContext(request.customer!.userId);
    if (ctx.user.emailVerified) return reply.send({ alreadyVerified: true });
    await createEmailVerification(ctx.user.id, ctx.user.email);
    reply.send({ sent: true });
  });

  fastify.get("/me", { preHandler: fastify.authenticateCustomer }, async (request) => {
    const ctx = await getCustomerAuthContext(request.customer!.userId);
    return publicCustomer(ctx);
  });

  // Device management — reuses DeviceToken (userId-keyed) and the DB-level
  // active-token uniqueness index shared with the business app.
  fastify.post("/devices", { preHandler: fastify.authenticateCustomer }, async (request, reply) => {
    const input = customerDeviceSchema.parse(request.body);
    const userId = request.customer!.userId;
    await prisma.deviceToken.updateMany({ where: { token: input.token, isActive: true, NOT: { userId } }, data: { isActive: false, revokedAt: new Date(), revokedReason: "reassigned" } });
    const existing = await prisma.deviceToken.findFirst({ where: { userId, token: input.token }, select: { id: true } });
    const device = existing
      ? await prisma.deviceToken.update({ where: { id: existing.id }, data: { isActive: true, revokedAt: null, revokedReason: null, lastUsedAt: new Date(), platform: input.platform } })
      : await prisma.deviceToken.create({ data: { userId, token: input.token, platform: input.platform } });
    reply.status(201).send({ id: device.id, platform: device.platform, isActive: device.isActive });
  });

  fastify.delete("/devices/:token", { preHandler: fastify.authenticateCustomer }, async (request, reply) => {
    const { token } = z.object({ token: z.string().min(1) }).parse(request.params);
    await prisma.deviceToken.updateMany({ where: { userId: request.customer!.userId, token, isActive: true }, data: { isActive: false, revokedAt: new Date(), revokedReason: "customer_removed" } });
    reply.status(204).send();
  });
}
