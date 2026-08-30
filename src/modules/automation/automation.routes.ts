import type { FastifyInstance } from "fastify";
import { createAutomationRuleSchema, createWorkflowSchema, createWorkflowVersionSchema, listAutomationRunHistoryQuerySchema, manualWorkflowSchema, publishWorkflowSchema, updateAutomationRuleSchema, workflowAnalyticsQuerySchema, workflowExecutionActionSchema, workflowExecutionQuerySchema } from "./automation.schemas.js";
import {
  listAutomationRules,
  getAutomationRule,
  createAutomationRule,
  updateAutomationRule,
  setAutomationRuleEnabled,
  listAutomationRunHistory,
} from "./automation.service.js";
import { getAutomationFoundationStatus } from "./automationFoundation.js";
import { controlExecution, createWorkflow, createWorkflowVersion, getWorkflow, listWorkflowExecutions, listWorkflows, publishWorkflow, setWorkflowStatus, triggerWorkflowManually, workflowAnalytics } from "./workflow.service.js";
import { listWorkflowTemplates } from "./workflowTemplates.js";
import { assertFeatureAvailable } from "../../lib/entitlements.js";
import { ApiError } from "../../lib/errors.js";
import { requireAutomationPermission } from "./automation.permissions.js";

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

  // Foundation status is read-only and deliberately does not expose any
  // workflow execution controls. Values are resolved server-side so clients
  // cannot enable gated capabilities or bypass kill switches.
  fastify.get("/foundation/status", async (request, reply) => {
    reply.send(await getAutomationFoundationStatus(request.businessId, request.user?.userId));
  });
  fastify.get("/workflows", async (request, reply) => { requireAutomationPermission(request, "workflow.view"); reply.send(await listWorkflows(request.businessId!)); });
  fastify.get("/workflow-templates", async (request, reply) => { requireAutomationPermission(request, "workflow.view"); reply.send({ items: await listWorkflowTemplates() }); });
  fastify.get<{ Params: { id: string } }>("/workflows/:id", async (request, reply) => { requireAutomationPermission(request, "workflow.view"); reply.send(await getWorkflow(request.businessId!, request.params.id)); });
  const ensureAutomationAvailable = async (businessId: string, userId?: string) => { const foundation = await getAutomationFoundationStatus(businessId, userId); if (foundation.maintenance || !foundation.killSwitches.automation || foundation.capabilities.workflows === "DISABLED") throw ApiError.serviceUnavailable("Automation is temporarily unavailable"); };
  fastify.post("/workflows", async (request, reply) => { requireAutomationPermission(request, "workflow.edit"); assertFeatureAvailable(request.plan!, request.status!, "AUTOMATION"); await ensureAutomationAvailable(request.businessId!, request.user.userId); const body = createWorkflowSchema.parse(request.body); reply.code(201).send(await createWorkflow(request.businessId!, request.user.userId, body.name, body.definition, body.description)); });
  fastify.post<{ Params: { id: string } }>("/workflows/:id/versions", async (request, reply) => { requireAutomationPermission(request, "workflow.edit"); const body = createWorkflowVersionSchema.parse(request.body); reply.code(201).send(await createWorkflowVersion(request.businessId!, request.params.id, body.definition)); });
  fastify.post<{ Params: { id: string } }>("/workflows/:id/publish", async (request, reply) => { requireAutomationPermission(request, "workflow.publish"); assertFeatureAvailable(request.plan!, request.status!, "AUTOMATION"); await ensureAutomationAvailable(request.businessId!, request.user.userId); const body = publishWorkflowSchema.parse(request.body ?? {}); reply.send(await publishWorkflow(request.businessId!, request.params.id, body.version)); });
  fastify.post<{ Params: { id: string } }>("/workflows/:id/pause", async (request, reply) => { requireAutomationPermission(request, "workflow.pause"); reply.send(await setWorkflowStatus(request.businessId!, request.params.id, "PAUSED")); });
  fastify.post<{ Params: { id: string } }>("/workflows/:id/resume", async (request, reply) => { requireAutomationPermission(request, "workflow.resume"); assertFeatureAvailable(request.plan!, request.status!, "AUTOMATION"); await ensureAutomationAvailable(request.businessId!, request.user.userId); reply.send(await setWorkflowStatus(request.businessId!, request.params.id, "PUBLISHED")); });
  fastify.delete<{ Params: { id: string } }>("/workflows/:id", async (request, reply) => { requireAutomationPermission(request, "workflow.delete"); reply.send(await setWorkflowStatus(request.businessId!, request.params.id, "ARCHIVED")); });
  fastify.post<{ Params: { id: string } }>("/workflows/:id/trigger", async (request, reply) => { requireAutomationPermission(request, "workflow.resume"); assertFeatureAvailable(request.plan!, request.status!, "AUTOMATION"); await ensureAutomationAvailable(request.businessId!, request.user.userId); const body = manualWorkflowSchema.parse(request.body ?? {}); reply.code(202).send(await triggerWorkflowManually(request.businessId!, request.params.id, body.input)); });
  fastify.get("/workflow-executions", async (request, reply) => { requireAutomationPermission(request, "workflow.view"); reply.send({ items: await listWorkflowExecutions(request.businessId!, workflowExecutionQuerySchema.parse(request.query)) }); });
  fastify.post<{ Params: { id: string; action: string } }>("/workflow-executions/:id/:action", async (request, reply) => { const action = workflowExecutionActionSchema.parse(request.params.action); requireAutomationPermission(request, action === "pause" || action === "cancel" ? "workflow.pause" : "workflow.resume"); reply.send(await controlExecution(request.businessId!, request.params.id, action)); });
  fastify.get("/workflow-analytics", async (request, reply) => { requireAutomationPermission(request, "automation.analytics"); reply.send(await workflowAnalytics(request.businessId!, workflowAnalyticsQuerySchema.parse(request.query).days)); });

  fastify.get("/rules", async (request, reply) => {
    reply.send(await listAutomationRules(request.businessId!));
  });

  fastify.get<{ Params: { id: string } }>("/rules/:id", async (request, reply) => {
    reply.send(await getAutomationRule(request.businessId!, request.params.id));
  });

  fastify.post("/rules", async (request, reply) => {
    const input = createAutomationRuleSchema.parse(request.body);
    const rule = await createAutomationRule(request.businessId!, request.plan!, request.status!, input);
    reply.status(201).send(rule);
  });

  fastify.patch<{ Params: { id: string } }>("/rules/:id", async (request, reply) => {
    const input = updateAutomationRuleSchema.parse(request.body);
    reply.send(await updateAutomationRule(request.businessId!, request.plan!, request.status!, request.params.id, input));
  });

  fastify.post<{ Params: { id: string } }>("/rules/:id/enable", async (request, reply) => {
    reply.send(await setAutomationRuleEnabled(request.businessId!, request.plan!, request.status!, request.params.id, true));
  });

  fastify.post<{ Params: { id: string } }>("/rules/:id/disable", async (request, reply) => {
    reply.send(await setAutomationRuleEnabled(request.businessId!, request.plan!, request.status!, request.params.id, false));
  });

  // Read-only history — deliberately not gated by assertFeatureAvailable
  // ("AUTOMATION"). Past runs are historical account data the business
  // already owns; a lapsed subscription or a disabled/deleted rule must
  // not hide them. See listAutomationRunHistory's doc comment.
  fastify.get("/runs", async (request, reply) => {
    const query = listAutomationRunHistoryQuerySchema.parse(request.query);
    reply.send(await listAutomationRunHistory(request.businessId!, query));
  });
}
