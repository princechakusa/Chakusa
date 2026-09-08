import type { FastifyInstance } from "fastify";
import { dispatchAssignSchema, dispatchBoardSchema, dispatchCandidatesSchema } from "./dispatch.schemas.js";
import { assignDispatch, getDispatchBoard, getDispatchCandidates } from "./dispatch.service.js";
import { requireCapability } from "../../lib/authorization.js";

export default async function dispatchRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/", async (request, reply) => {
    requireCapability(request, "appointments.operate");
    reply.send(await getDispatchBoard(request.businessId!, dispatchBoardSchema.parse(request.query).date));
  });
  fastify.get("/candidates", async (request, reply) => {
    requireCapability(request, "appointments.operate");
    reply.send(await getDispatchCandidates(request.businessId!, dispatchCandidatesSchema.parse(request.query).appointmentId));
  });
  fastify.post("/assign", async (request, reply) => {
    requireCapability(request, "appointments.manage");
    reply.send(await assignDispatch(request.businessId!, request.user.userId, dispatchAssignSchema.parse(request.body)));
  });
}
