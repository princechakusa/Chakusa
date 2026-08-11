import type { FastifyInstance } from "fastify";
import { getDashboardSummary } from "./dashboard.service.js";

export default async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/summary", async (request, reply) => {
    reply.send(await getDashboardSummary(request.businessId!));
  });
}
