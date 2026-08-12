import type { FastifyInstance } from "fastify";
import { config } from "../../lib/config.js";
import { ApiError } from "../../lib/errors.js";
import {
  deleteAccountSchema,
  appleAuthSchema,
  forgotPasswordSchema,
  googleAuthSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.schemas.js";
import {
  authenticateUser,
  authenticateAppleIdentity,
  createAppleChallenge,
  authenticateGoogleIdentity,
  createPasswordReset,
  deleteAccount,
  deleteAccountWithGoogle,
  deleteAccountWithApple,
  getAppleDeletionCredential,
  getOptionalAppleDeletionCredential,
  getUserContext,
  linkGoogleIdentity,
  linkAppleIdentity,
  registerUser,
  resetPassword,
  revokeAllSessions,
  revokeSessionFamily,
  rotateRefreshToken,
  validateAppleChallenge,
  verifyAccountPassword,
} from "./auth.service.js";
import { sendPasswordResetEmail } from "./passwordResetEmail.js";
import { requireFreshGoogleIdentity, verifyGoogleIdToken, type GoogleTokenVerifier } from "./googleVerifier.js";
import {
  exchangeAppleAuthorizationCode,
  revokeAppleCredential,
  verifyAppleIdentityToken,
  type AppleCodeExchanger,
  type AppleCredentialRevoker,
  type AppleTokenVerifier,
} from "./appleAuth.js";

export interface AuthRouteOptions {
  googleTokenVerifier?: GoogleTokenVerifier;
  appleTokenVerifier?: AppleTokenVerifier;
  appleCodeExchanger?: AppleCodeExchanger;
  appleCredentialRevoker?: AppleCredentialRevoker;
}

const publicUser = (user: { id: string; email: string; fullName: string }) => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  hasPassword: true,
});

export default async function authRoutes(fastify: FastifyInstance, options: AuthRouteOptions) {
  const googleTokenVerifier = options.googleTokenVerifier ?? verifyGoogleIdToken;
  const appleTokenVerifier = options.appleTokenVerifier ?? verifyAppleIdentityToken;
  const appleCodeExchanger = options.appleCodeExchanger ?? exchangeAppleAuthorizationCode;
  const appleCredentialRevoker = options.appleCredentialRevoker ?? revokeAppleCredential;
  const exchangeAndBindAppleCode = async (authorizationCode: string, nonce: string, presentedSubject: string, presentedEmail: string) => {
    const tokens = await appleCodeExchanger(authorizationCode);
    const exchanged = await appleTokenVerifier(tokens.identityToken, nonce);
    if (exchanged.providerSubject !== presentedSubject || exchanged.email.toLowerCase() !== presentedEmail.toLowerCase()) {
      throw ApiError.auth(401, "APPLE_CODE_INVALID", "Apple authorization code does not match the presented identity");
    }
    return tokens;
  };
  const sessionResponse = (userId: string, sessionId: string, refreshToken: string) => {
    const accessToken = fastify.jwt.sign(
      { userId, sessionId, type: "access" },
      { expiresIn: config.ACCESS_TOKEN_TTL_SECONDS },
    );
    return {
      accessToken,
      token: accessToken,
      refreshToken,
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
      tokenType: "Bearer",
    };
  };

  fastify.post(
    "/register",
    { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = registerSchema.parse(request.body);
      const { user, business, session, refreshToken } = await registerUser(input);
      reply.status(201).send({
        ...sessionResponse(user.id, session.id, refreshToken),
        user: publicUser(user),
        business: { id: business.id, name: business.name, industry: business.industry },
      });
    },
  );

  fastify.post(
    "/login",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const { user, session, refreshToken } = await authenticateUser(input);
      const { user: contextUser, business, role } = await getUserContext(user.id);
      reply.send({
        ...sessionResponse(user.id, session.id, refreshToken),
        user: contextUser,
        business,
        role,
      });
    },
  );

  fastify.post(
    "/google",
    { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = googleAuthSchema.parse(request.body);
      const verifiedIdentity = await googleTokenVerifier(input.idToken);
      const { user, session, refreshToken, isNewUser } = await authenticateGoogleIdentity(verifiedIdentity);
      const { user: contextUser, business, role } = await getUserContext(user.id);
      reply.send({
        ...sessionResponse(user.id, session.id, refreshToken),
        user: contextUser,
        business,
        role,
        isNewUser,
      });
    },
  );

  fastify.post(
    "/google/link",
    { preHandler: fastify.authenticate, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = googleAuthSchema.parse(request.body);
      const verifiedIdentity = await googleTokenVerifier(input.idToken);
      requireFreshGoogleIdentity(verifiedIdentity);
      const identity = await linkGoogleIdentity(request.user.userId, verifiedIdentity);
      reply.send({
        provider: identity.provider,
        providerEmail: identity.providerEmail,
        linkedAt: identity.createdAt,
      });
    },
  );

  fastify.post(
    "/apple/challenge",
    { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
    async (_request, reply) => reply.send(await createAppleChallenge("APPLE_SIGN_IN")),
  );

  fastify.post(
    "/apple/link/challenge",
    { preHandler: fastify.authenticate, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => reply.send(await createAppleChallenge("APPLE_LINK", request.user.userId)),
  );

  fastify.post(
    "/apple/delete/challenge",
    { preHandler: fastify.authenticate, config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => reply.send(await createAppleChallenge("APPLE_DELETE", request.user.userId)),
  );

  fastify.post(
    "/apple",
    { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = appleAuthSchema.parse(request.body);
      const proof = { challengeId: input.challengeId, nonce: input.nonce, state: input.state };
      await validateAppleChallenge(proof, "APPLE_SIGN_IN");
      const identity = await appleTokenVerifier(input.identityToken, input.nonce);
      const tokens = await exchangeAndBindAppleCode(input.authorizationCode, input.nonce, identity.providerSubject, identity.email);
      const result = await authenticateAppleIdentity(identity, tokens.refreshToken, proof, input);
      const context = await getUserContext(result.user.id);
      reply.send({ ...sessionResponse(result.user.id, result.session.id, result.refreshToken), ...context, isNewUser: result.isNewUser });
    },
  );

  fastify.post(
    "/apple/link",
    { preHandler: fastify.authenticate, config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = appleAuthSchema.parse(request.body);
      const proof = { challengeId: input.challengeId, nonce: input.nonce, state: input.state };
      await validateAppleChallenge(proof, "APPLE_LINK", request.user.userId);
      const identity = await appleTokenVerifier(input.identityToken, input.nonce);
      const tokens = await exchangeAndBindAppleCode(input.authorizationCode, input.nonce, identity.providerSubject, identity.email);
      const linked = await linkAppleIdentity(request.user.userId, identity, tokens.refreshToken, proof);
      reply.send({ provider: linked.provider, providerEmail: linked.providerEmail, linkedAt: linked.createdAt });
    },
  );

  fastify.post(
    "/refresh",
    { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const input = refreshSchema.parse(request.body);
      const result = await rotateRefreshToken(input.refreshToken);
      reply.send(sessionResponse(result.userId, result.session.id, result.refreshToken));
    },
  );

  fastify.post("/logout", async (request, reply) => {
    const input = logoutSchema.parse(request.body);
    await revokeSessionFamily(input.refreshToken);
    reply.status(204).send();
  });

  fastify.post(
    "/logout-all",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      await revokeAllSessions(request.user.userId);
      reply.status(204).send();
    },
  );

  fastify.post(
    "/forgot-password",
    { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } },
    async (request, reply) => {
      const input = forgotPasswordSchema.parse(request.body);
      const token = await createPasswordReset(input.email);
      if (token) {
        const delivered = await sendPasswordResetEmail(input.email.trim().toLowerCase(), token);
        if (!delivered) request.log.warn("Password reset email was not delivered");
      }
      reply.status(202).send({ message: "If an account exists, password reset instructions have been sent." });
    },
  );

  fastify.post("/reset-password", async (request, reply) => {
    const input = resetPasswordSchema.parse(request.body);
    await resetPassword(input.token, input.password);
    reply.send({ message: "Password reset successfully. Sign in with your new password." });
  });

  fastify.post(
    "/delete-account",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const input = deleteAccountSchema.parse(request.body);
      if ("password" in input) {
        await verifyAccountPassword(request.user.userId, input.password);
        // Only attempt to revoke a linked Apple credential if Apple auth is
        // still enabled — if it's been disabled, there's no live provider
        // integration to revoke against, and account deletion must still
        // proceed via the password path regardless.
        if (config.APPLE_AUTH_ENABLED) {
          const apple = await getOptionalAppleDeletionCredential(request.user.userId);
          if (apple) await appleCredentialRevoker(apple.refreshToken);
        }
        await deleteAccount(request.user.userId, input.password);
      } else if ("googleIdToken" in input) {
        const verifiedIdentity = await googleTokenVerifier(input.googleIdToken);
        requireFreshGoogleIdentity(verifiedIdentity);
        if (config.APPLE_AUTH_ENABLED) {
          const apple = await getOptionalAppleDeletionCredential(request.user.userId);
          if (apple) await appleCredentialRevoker(apple.refreshToken);
        }
        await deleteAccountWithGoogle(request.user.userId, verifiedIdentity.providerSubject);
      } else {
        const proof = { challengeId: input.apple.challengeId, nonce: input.apple.nonce, state: input.apple.state };
        await validateAppleChallenge(proof, "APPLE_DELETE", request.user.userId);
        const identity = await appleTokenVerifier(input.apple.identityToken, input.apple.nonce);
        const stored = await getAppleDeletionCredential(request.user.userId);
        if (stored.providerSubject !== identity.providerSubject) {
          throw ApiError.auth(401, "AUTH_REAUTHENTICATION_REQUIRED", "Apple account confirmation failed");
        }
        const fresh = await exchangeAndBindAppleCode(input.apple.authorizationCode, input.apple.nonce, identity.providerSubject, identity.email);
        for (const token of new Set([stored.refreshToken, fresh.refreshToken])) await appleCredentialRevoker(token);
        await deleteAccountWithApple(request.user.userId, identity.providerSubject, proof);
      }
      reply.status(204).send();
    },
  );

  fastify.get("/me", { preHandler: fastify.authenticate }, async (request, reply) => {
    reply.send(await getUserContext(request.user.userId));
  });
}
