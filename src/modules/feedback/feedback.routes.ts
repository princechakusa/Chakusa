import type { FastifyInstance } from "fastify";
import { createFeedbackSchema, respondToFeedbackSchema, updateFeedbackStatusSchema } from "./feedback.schemas.js";
import { listFeedback, createFeedback, respondToFeedback, updateFeedbackStatus } from "./feedback.service.js";
import { requireCapability } from "../../lib/authorization.js";

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

  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const input = updateFeedbackStatusSchema.parse(request.body);
    const feedback = await updateFeedbackStatus(
      request.businessId!,
      request.user.userId,
      request.params.id,
      input,
    );
    reply.send(feedback);
  });

  // #20 — the business's public reply to a review. Not sentiment-gated.
  fastify.post<{ Params: { id: string } }>("/:id/respond", async (request, reply) => {
    requireCapability(request, "reviews.manage");
    const input = respondToFeedbackSchema.parse(request.body);
    const feedback = await respondToFeedback(request.businessId!, request.user.userId, request.params.id, input);
    reply.send(feedback);
  });
}
