import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBusinessRole } from "../../lib/authorization.js";
import { archiveServiceOffering, createServiceOffering, getServiceOffering, listServiceOfferings, updateServiceOffering } from "./services.service.js";
import { createServiceOfferingSchema, listServiceOfferingsSchema, updateServiceOfferingSchema } from "./services.schemas.js";

const idParams = z.object({ id: z.string().uuid() });
export default async function serviceOfferingRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);
  fastify.get("/", async (request, reply) => reply.send(await listServiceOfferings(request.businessId!, listServiceOfferingsSchema.parse(request.query).active)));
  fastify.get("/:id", async (request, reply) => reply.send(await getServiceOffering(request.businessId!, idParams.parse(request.params).id)));
  fastify.post("/", async (request, reply) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); reply.status(201).send(await createServiceOffering(request.businessId!, createServiceOfferingSchema.parse(request.body))); });
  fastify.patch("/:id", async (request, reply) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); reply.send(await updateServiceOffering(request.businessId!, idParams.parse(request.params).id, updateServiceOfferingSchema.parse(request.body))); });
  fastify.delete("/:id", async (request, reply) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); reply.send(await archiveServiceOffering(request.businessId!, idParams.parse(request.params).id)); });
}
