import type { FastifyInstance } from "fastify";
import { createFeedbackSchema } from "./feedback.schemas.js";
import { listFeedback, createFeedback } from "./feedback.service.js";

export default async function feedbackRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/", async (request, reply) => {
    reply.send(await listFeedback(request.businessId!));
  });

  fastify.post("/", async (request, reply) => {
    const input = createFeedbackSchema.parse(request.body);
    const feedback = await createFeedback(request.businessId!, request.user.userId, input);
    reply.status(201).send(feedback);
  });
}
