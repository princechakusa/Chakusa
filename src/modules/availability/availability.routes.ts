import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBusinessRole } from "../../lib/authorization.js";
import { availabilityQuerySchema, bookingBlockListSchema, createBookingBlockSchema, memberHoursSchema } from "./availability.schemas.js";
import { calculateAvailability, createBookingBlock, deleteBookingBlock, listBookingBlocks, updateMemberWorkingHours } from "./availability.service.js";

const idParams = z.object({ id: z.string().uuid() });
export default async function availabilityRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);
  fastify.get("/", async (request, reply) => reply.send(await calculateAvailability(request.businessId!, availabilityQuerySchema.parse(request.query))));
  fastify.get("/blocks", async (request, reply) => { const input = bookingBlockListSchema.parse(request.query); reply.send(await listBookingBlocks(request.businessId!, input.from, input.to)); });
  fastify.post("/blocks", async (request, reply) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); reply.status(201).send(await createBookingBlock(request.businessId!, request.user.userId, createBookingBlockSchema.parse(request.body))); });
  fastify.delete("/blocks/:id", async (request, reply) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); await deleteBookingBlock(request.businessId!, idParams.parse(request.params).id); reply.status(204).send(); });
  fastify.patch("/members/:id/hours", async (request, reply) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); const input = memberHoursSchema.parse(request.body); reply.send(await updateMemberWorkingHours(request.businessId!, idParams.parse(request.params).id, input.workingHours)); });
}
