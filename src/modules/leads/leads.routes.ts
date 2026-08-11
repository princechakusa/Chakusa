import type { FastifyInstance } from "fastify";
import { createLeadSchema, updateLeadSchema, listLeadsQuerySchema } from "./leads.schemas.js";
import {
  listLeads,
  createLead,
  getLead,
  updateLead,
  generateLeadMessage,
  transitionLead,
} from "./leads.service.js";

export default async function leadRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/", async (request, reply) => {
    const query = listLeadsQuerySchema.parse(request.query);
    reply.send(await listLeads(request.businessId!, query));
  });

  fastify.post("/", async (request, reply) => {
    const input = createLeadSchema.parse(request.body);
    const lead = await createLead(request.businessId!, request.user.userId, input);
    reply.status(201).send(lead);
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    reply.send(await getLead(request.businessId!, request.params.id));
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const input = updateLeadSchema.parse(request.body);
    reply.send(await updateLead(request.businessId!, request.params.id, input));
  });

  fastify.post<{ Params: { id: string } }>("/:id/generate-message", async (request, reply) => {
    reply.send(await generateLeadMessage(request.businessId!, request.params.id));
  });

  fastify.post<{ Params: { id: string } }>("/:id/mark-contacted", async (request, reply) => {
    reply.send(
      await transitionLead(request.businessId!, request.user.userId, request.params.id, "contacted"),
    );
  });

  fastify.post<{ Params: { id: string } }>("/:id/mark-booked", async (request, reply) => {
    reply.send(
      await transitionLead(request.businessId!, request.user.userId, request.params.id, "booked"),
    );
  });

  fastify.post<{ Params: { id: string } }>("/:id/mark-won", async (request, reply) => {
    reply.send(
      await transitionLead(request.businessId!, request.user.userId, request.params.id, "won"),
    );
  });

  fastify.post<{ Params: { id: string } }>("/:id/mark-lost", async (request, reply) => {
    reply.send(
      await transitionLead(request.businessId!, request.user.userId, request.params.id, "lost"),
    );
  });
}
