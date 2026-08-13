import type { FastifyInstance } from "fastify";
import { createAutomationRuleSchema, updateAutomationRuleSchema } from "./automation.schemas.js";
import {
  listAutomationRules,
  getAutomationRule,
  createAutomationRule,
  updateAutomationRule,
  setAutomationRuleEnabled,
} from "./automation.service.js";

/**
 * Configuration management only. There is no POST /automation/run or any
 * equivalent — creating/transitioning an AutomationRun is reachable only
 * from internal code and tests (see automation.service.ts), never from an
 * HTTP request, because Phase 3 has no execution engine to authorize
 * against.
 */
export default async function automationRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/rules", async (request, reply) => {
    reply.send(await listAutomationRules(request.businessId!));
  });

  fastify.get<{ Params: { id: string } }>("/rules/:id", async (request, reply) => {
    reply.send(await getAutomationRule(request.businessId!, request.params.id));
  });

  fastify.post("/rules", async (request, reply) => {
    const input = createAutomationRuleSchema.parse(request.body);
    const rule = await createAutomationRule(request.businessId!, request.plan!, input);
    reply.status(201).send(rule);
  });

  fastify.patch<{ Params: { id: string } }>("/rules/:id", async (request, reply) => {
    const input = updateAutomationRuleSchema.parse(request.body);
    reply.send(await updateAutomationRule(request.businessId!, request.plan!, request.params.id, input));
  });

  fastify.post<{ Params: { id: string } }>("/rules/:id/enable", async (request, reply) => {
    reply.send(await setAutomationRuleEnabled(request.businessId!, request.plan!, request.params.id, true));
  });

  fastify.post<{ Params: { id: string } }>("/rules/:id/disable", async (request, reply) => {
    reply.send(await setAutomationRuleEnabled(request.businessId!, request.plan!, request.params.id, false));
  });
}
