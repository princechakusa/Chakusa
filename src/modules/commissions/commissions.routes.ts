import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { assertFeatureAvailable } from "../../lib/entitlements.js";
import { requireBusinessRole, requireOwner } from "../../lib/authorization.js";
import { commissionReportQuerySchema, upsertCommissionRuleSchema } from "./commissions.schemas.js";
import { deleteCommissionRule, getCommissionReport, listCommissionRules, upsertCommissionRule } from "./commissions.service.js";

const idParams = z.object({ id: z.string().uuid() });

/**
 * Operational commissions (master directive s20). Rules and the earned-figure
 * report are a Business-tier team feature. Rule writes are owner-only (they
 * are compensation configuration); reads are available to OWNER/ADMIN.
 */
export default async function commissionRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/rules", async (request, reply) => {
    requireBusinessRole(request, ["OWNER", "ADMIN"]);
    assertFeatureAvailable(request.plan!, request.status!, "TEAM_MANAGEMENT");
    reply.send(await listCommissionRules(request.businessId!));
  });

  fastify.put("/rules", async (request, reply) => {
    requireOwner(request);
    assertFeatureAvailable(request.plan!, request.status!, "TEAM_MANAGEMENT");
    const input = upsertCommissionRuleSchema.parse(request.body);
    reply.send(await upsertCommissionRule(request.businessId!, request.user.userId, input));
  });

  fastify.delete("/rules/:id", async (request, reply) => {
    requireOwner(request);
    assertFeatureAvailable(request.plan!, request.status!, "TEAM_MANAGEMENT");
    await deleteCommissionRule(request.businessId!, idParams.parse(request.params).id);
    reply.status(204).send();
  });

  fastify.get("/report", async (request, reply) => {
    requireBusinessRole(request, ["OWNER", "ADMIN"]);
    assertFeatureAvailable(request.plan!, request.status!, "TEAM_MANAGEMENT");
    reply.send(await getCommissionReport(request.businessId!, commissionReportQuerySchema.parse(request.query)));
  });
}
