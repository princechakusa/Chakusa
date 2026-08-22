import type { FastifyInstance } from "fastify";
import { getDashboardSummary } from "./dashboard.service.js";
import { listAttentionItems } from "./attentionCenter.service.js";
import { getBusinessInsights } from "./insights.service.js";
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

  // Growth analytics — deliberately a separate, on-demand endpoint rather
  // than folded into /summary: it's heavier (6-month trend series, service
  // and per-customer aggregates) than every Dashboard load needs, and
  // /summary's existing consumers must not pay for a payload they don't
  // use. See insights.service.ts.
  fastify.get("/insights", async (request, reply) => {
    reply.send(await getBusinessInsights(request.businessId!));
  });
}
