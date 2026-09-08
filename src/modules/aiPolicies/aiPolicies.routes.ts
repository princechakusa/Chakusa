import type { FastifyInstance } from "fastify";
import { requireCapability } from "../../lib/authorization.js";
import {
  activatePolicy,
  getPolicyOverview,
  listPolicyDecisions,
  listPolicyHistory,
  replacePolicyRules,
  savePolicyDraft,
} from "../../lib/ai/policyAdmin.js";
import { evaluatePolicy } from "../../lib/ai/policyEngine.js";
import { activateSchema, decisionsQuerySchema, evaluateSchema, rulesSchema, saveDraftSchema } from "./aiPolicies.schemas.js";


export default async function aiPolicyRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/", async (request) => getPolicyOverview(request.businessId!));

  fastify.get("/history", async (request) => listPolicyHistory(request.businessId!));

  fastify.get("/decisions", async (request) => {
    const { limit } = decisionsQuerySchema.parse(request.query);
    return listPolicyDecisions(request.businessId!, limit);
  });

  fastify.put("/draft", async (request) => {
    requireCapability(request, "automation.manage");
    const input = saveDraftSchema.parse(request.body);
    return savePolicyDraft({ businessId: request.businessId!, mode: input.mode, document: input.document, actorUserId: request.user!.userId });
  });

  fastify.put("/draft/rules", async (request) => {
    requireCapability(request, "automation.manage");
    const input = rulesSchema.parse(request.body);
    return replacePolicyRules({ businessId: request.businessId!, rules: input.rules, actorUserId: request.user!.userId });
  });

  fastify.post("/activate", async (request) => {
    requireCapability(request, "automation.manage");
    const input = activateSchema.parse(request.body ?? {});
    return activatePolicy({ businessId: request.businessId!, version: input.version, actorUserId: request.user!.userId });
  });

  fastify.post("/evaluate", async (request) => {
    const input = evaluateSchema.parse(request.body);
    return evaluatePolicy({ businessId: request.businessId!, ...input, dryRun: true });
  });
}
