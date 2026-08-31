import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { getAction, validateActionConfig } from "../automation/actionRegistry.js";
import { businessAIContext, routeAI } from "./aiGateway.js";
import { renderPublishedPrompt } from "./promptRegistry.js";
import { evaluatePolicy } from "./policyEngine.js";

export const AI_RUN_STATES = ["RECEIVED","CONTEXT_READY","CLASSIFIED","PLANNED","TOOL_SELECTION","TOOL_EXECUTION","DRAFT_RESPONSE","HUMAN_APPROVAL","RESPONDING","COMPLETED","ESCALATED","FAILED"] as const;
const allowed = new Set(["UPDATE_CUSTOMER","UPDATE_LEAD","UPDATE_APPOINTMENT","CREATE_TASK","ASSIGN_STAFF","ESCALATE","PAUSE_WORKFLOW","RESUME_WORKFLOW"]);
// LOOP 3B-2: every Tool Broker request is evaluated by the Policy Engine at
// the TOOL_EXECUTION checkpoint before anything runs. DENY always blocks;
// REQUIRE_APPROVAL / ESCALATE block unless the caller carries an explicit
// human approval; ALLOW runs without one. `approved` is no longer a blanket
// requirement — the policy decides.
export async function executeAITool(input: { businessId: string; runId: string; name: string; config: unknown; idempotencyKey: string; approved?: boolean; workflowId?: string }) {
  if (!allowed.has(input.name)) throw ApiError.forbidden("AI tool is not allowlisted");
  const config = z.record(z.string(), z.unknown()).parse(input.config);
  const errors = validateActionConfig(input.name, config);
  if (errors.length) throw ApiError.badRequest("Invalid AI tool request", errors);
  const run = await prisma.aIConversationRun.findFirst({ where: { id: input.runId, businessId: input.businessId } });
  if (!run) throw ApiError.notFound("AI conversation run not found");

  const decision = await evaluatePolicy({
    businessId: input.businessId,
    checkpoint: "TOOL_EXECUTION",
    action: input.name,
    toolName: input.name,
    workflowId: input.workflowId,
    runId: run.id,
    conversationId: run.conversationId,
    customerId: run.customerId ?? undefined,
    correlationId: input.idempotencyKey,
  });
  if (decision.effect === "DENY") {
    throw ApiError.forbidden(`Policy denied tool "${input.name}": ${decision.reasons.map((reason) => reason.message).join("; ")}`, { code: "POLICY_DENIED", decisionId: decision.decisionId });
  }
  if ((decision.effect === "REQUIRE_APPROVAL" || decision.effect === "ESCALATE") && !input.approved) {
    throw ApiError.forbidden("AI tool execution requires human approval under the active policy", { code: "POLICY_APPROVAL_REQUIRED", decisionId: decision.decisionId, reasons: decision.reasons, strategy: decision.requiredApprovalStrategy });
  }

  const handler = getAction(input.name);
  if (!handler) throw ApiError.serviceUnavailable("AI tool handler is not configured");
  const existing = await prisma.aIInvocationLedger.findFirst({ where: { businessId: input.businessId, correlationId: input.idempotencyKey, outcome: "TOOL_COMPLETED" } });
  if (existing) return { replayed: true };
  const result = await handler({ businessId: input.businessId, executionId: `ai:${run.id}`, nodeId: input.name, input: run.state, idempotencyKey: input.idempotencyKey, signal: AbortSignal.timeout(30_000) }, config);
  await prisma.aIInvocationLedger.create({ data: { businessId: input.businessId, customerId: run.customerId, conversationId: run.conversationId, provider: "tool-broker", model: input.name, promptVersion: "tool-v1", promptChecksum: createHash("sha256").update(input.name).digest("hex"), correlationId: input.idempotencyKey, safetyResult: "PASSED", outcome: "TOOL_COMPLETED", approvalStatus: decision.effect, toolRequests: { name: input.name, policyDecisionId: decision.decisionId } } });
  return result;
}
export async function advanceAIConversation(input: { businessId: string; runId: string; prompt: string; mode?: "DRAFT" | "APPROVAL" | "AUTONOMOUS" }) { const run = await prisma.aIConversationRun.findFirst({ where: { id: input.runId, businessId: input.businessId } }); if (!run) throw ApiError.notFound("AI conversation run not found"); const transitions = ["CONTEXT_READY","CLASSIFIED","PLANNED","TOOL_SELECTION","DRAFT_RESPONSE"] as const; for (const status of transitions) await prisma.aIConversationRun.update({ where: { id: run.id }, data: { status } }); const context = await businessAIContext(input.businessId, run.customerId ?? undefined); const resolved = await renderPublishedPrompt({ templateKey: "conversation.orchestrator", businessId: input.businessId, values: { message: input.prompt } }); const response = await routeAI({ businessId: input.businessId, customerId: run.customerId ?? undefined, conversationId: run.conversationId, runId: run.id, task: "conversation", prompt: resolved.rendered.prompt, context, promptVersionId: resolved.versionId, requiredCapability: resolved.requiredCapability ?? "conversation" });
  // LOOP 3B-2: the drafted reply is cleared by the Policy Engine at the
  // CUSTOMER_RESPONSE checkpoint. The decision — not the caller — sets the
  // terminal state: DENY -> FAILED, ESCALATE -> ESCALATED, REQUIRE_APPROVAL
  // (or an explicit APPROVAL mode) -> HUMAN_APPROVAL, ALLOW -> COMPLETED.
  const outputText = typeof response.output === "string" ? response.output : JSON.stringify(response.output);
  const decision = await evaluatePolicy({ businessId: input.businessId, checkpoint: "CUSTOMER_RESPONSE", action: "reply", runId: run.id, conversationId: run.conversationId, customerId: run.customerId ?? undefined, confidence: response.confidence, outputText });
  const next = decision.effect === "DENY" ? "FAILED" : decision.effect === "ESCALATE" ? "ESCALATED" : decision.effect === "REQUIRE_APPROVAL" || input.mode === "APPROVAL" ? "HUMAN_APPROVAL" : "COMPLETED";
  return prisma.aIConversationRun.update({ where: { id: run.id }, data: { status: next, mode: input.mode ?? decision.mode ?? run.mode, lastError: decision.effect === "DENY" ? decision.reasons.map((reason) => reason.message).join("; ") : null, state: { context, response: response.output, promptVersionId: resolved.versionId, ledgerId: response.ledgerId, policyDecisionId: decision.decisionId, policyOutcome: decision.effect } as never } }); }
