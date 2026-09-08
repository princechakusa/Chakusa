import type { FastifyInstance } from "fastify";
import { createTemplateSchema, updateTemplateSchema } from "./templates.schemas.js";
import { listTemplates, createTemplate, updateTemplate } from "./templates.service.js";
import { requireCapability } from "../../lib/authorization.js";

// Advanced Team #12: message templates are messaging configuration -
// "messaging.config.manage" (OWNER/ADMIN). Any member may read them.
export default async function templateRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/", async (request, reply) => {
    reply.send(await listTemplates(request.businessId!));
  });

  fastify.post("/", async (request, reply) => {
    requireCapability(request, "messaging.config.manage");
    const input = createTemplateSchema.parse(request.body);
    reply.status(201).send(await createTemplate(request.businessId!, input, request.plan!));
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    requireCapability(request, "messaging.config.manage");
    const input = updateTemplateSchema.parse(request.body);
    reply.send(await updateTemplate(request.businessId!, request.params.id, input));
  });
}
