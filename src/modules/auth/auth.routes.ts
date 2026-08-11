import type { FastifyInstance } from "fastify";
import { registerSchema, loginSchema } from "./auth.schemas.js";
import { registerUser, authenticateUser, getUserContext } from "./auth.service.js";

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post("/register", async (request, reply) => {
    const input = registerSchema.parse(request.body);
    const { user, business } = await registerUser(input);

    const token = fastify.jwt.sign({ userId: user.id });

    reply.status(201).send({
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      business: { id: business.id, name: business.name, industry: business.industry },
    });
  });

  fastify.post("/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const user = await authenticateUser(input);
    const { business, role } = await getUserContext(user.id);

    const token = fastify.jwt.sign({ userId: user.id });

    reply.send({
      token,
      user: { id: user.id, email: user.email, fullName: user.fullName },
      business,
      role,
    });
  });

  fastify.get(
    "/me",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const context = await getUserContext(request.user.userId);
      reply.send(context);
    },
  );
}
