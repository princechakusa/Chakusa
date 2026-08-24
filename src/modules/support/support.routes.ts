import type { FastifyInstance } from "fastify";
import { createSupportTicketSchema } from "./support.schemas.js";
import { createSupportTicket, listSupportTickets } from "./support.service.js";

export default async function supportRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);
  fastify.get("/", async (request, reply) => reply.send(await listSupportTickets(request.businessId!)));
  fastify.post("/", async (request, reply) => reply.code(201).send(await createSupportTicket(request.businessId!, request.user.userId, createSupportTicketSchema.parse(request.body))));
}
