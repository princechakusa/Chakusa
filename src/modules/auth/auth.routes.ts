import type { FastifyInstance } from "fastify";
import { config } from "../../lib/config.js";
import {
  deleteAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from "./auth.schemas.js";
import {
  authenticateUser,
  createPasswordReset,
  deleteAccount,
  getUserContext,
  registerUser,
  resetPassword,
  revokeAllSessions,
  revokeSessionFamily,
  rotateRefreshToken,
} from "./auth.service.js";
import { sendPasswordResetEmail } from "./passwordResetEmail.js";

const publicUser = (user: { id: string; email: string; fullName: string }) => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
});

export default async function authRoutes(fastify: FastifyInstance) {
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

  fastify.post("/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const { user, business, session, refreshToken } = await registerUser(input);
    reply.status(201).send({
      ...sessionResponse(user.id, session.id, refreshToken),
      user: publicUser(user),
      business: { id: business.id, name: business.name, industry: business.industry },
    });
  });

  fastify.post("/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const { user, session, refreshToken } = await authenticateUser(input);
    const { business, role } = await getUserContext(user.id);
    reply.send({
      ...sessionResponse(user.id, session.id, refreshToken),
      user: publicUser(user),
      business,
      role,
    });
  });

  fastify.post("/refresh", async (request, reply) => {
    const input = refreshSchema.parse(request.body);
    const result = await rotateRefreshToken(input.refreshToken);
    reply.send(sessionResponse(result.userId, result.session.id, result.refreshToken));
  });

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
      await deleteAccount(request.user.userId, input.password);
      reply.status(204).send();
    },
  );

  fastify.get("/me", { preHandler: fastify.authenticate }, async (request, reply) => {
    reply.send(await getUserContext(request.user.userId));
  });
}
