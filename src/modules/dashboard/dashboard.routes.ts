import type { FastifyInstance } from "fastify";
import { getDashboardSummary } from "./dashboard.service.js";
import { listAttentionItems } from "./attentionCenter.service.js";
import { listAttentionItemsQuerySchema } from "./dashboard.schemas.js";

export default async function dashboardRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/summary", async (request, reply) => {
    reply.send(await getDashboardSummary(request.businessId!));
  });

  // The complete, paginated Attention Center action queue — "See All"
  // calls this with a `category`; the landing view can call it with none
  // for a small merged preview. See attentionCenter.service.ts.
  fastify.get("/attention", async (request, reply) => {
    const query = listAttentionItemsQuerySchema.parse(request.query);
    reply.send(await listAttentionItems(request.businessId!, query));
  });
}
