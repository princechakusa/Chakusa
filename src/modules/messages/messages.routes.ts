import type { FastifyInstance } from "fastify";
import { sendMessageSchema } from "./messages.schemas.js";
import { sendMessage } from "./messages.service.js";

export default async function messageRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  // The only route in this phase — one explicitly, humanly initiated send.
  // request.businessId and request.plan are both server-resolved by
  // tenant.ts from the authenticated user's trusted membership/subscription;
  // sendMessageSchema has no `businessId`/`plan` field, so nothing the
  // client sends can override either.
  fastify.post("/send", async (request, reply) => {
    const input = sendMessageSchema.parse(request.body);
    const message = await sendMessage(request.businessId!, input, request.plan!);
    reply.status(201).send(message);
  });
}
