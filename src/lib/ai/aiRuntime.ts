import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { getAction, validateActionConfig } from "../automation/actionRegistry.js";
import { businessAIContext, routeAI } from "./aiGateway.js";
import { renderPublishedPrompt } from "./promptRegistry.js";
import { evaluatePolicy } from "./policyEngine.js";
import { retrieveMemory, formatMemoryForContext } from "./memory/retrievalEngine.js";
import { appendToolOutput, ensureSession, getSession, setSessionContext } from "./memory/memoryStore.js";
import { recordConversationEvent, summarizeConversation } from "./memory/summarization.js";
import type { RetrievalPhase, RetrievalResult } from "./memory/memoryTypes.js";
import { emitAIEvent } from "./ops/aiMetrics.js";
import { getAgentTool, isAgentTool } from "./agent/agentTools.js";

export const AI_RUN_STATES = ["RECEIVED","CONTEXT_READY","CLASSIFIED","PLANNED","TOOL_SELECTION","TOOL_EXECUTION","DRAFT_RESPONSE","HUMAN_APPROVAL","RESPONDING","COMPLETED","ESCALATED","FAILED"] as const;
const allowed = new Set(["UPDATE_CUSTOMER","UPDATE_LEAD","UPDATE_APPOINTMENT","CREATE_TASK","ASSIGN_STAFF","ESCALATE","PAUSE_WORKFLOW","RESUME_WORKFLOW"]);
// LOOP 3B-2: every Tool Broker request is evaluated by the Policy Engine at
// the TOOL_EXECUTION checkpoint before anything runs. DENY always blocks;
// REQUIRE_APPROVAL / ESCALATE block unless the caller carries an explicit
// human approval; ALLOW runs without one. `approved` is no longer a blanket
// requirement — the policy decides.
// LOOP 4: the same broker also serves the AI Receptionist's tool set
// (agentTools.ts) — automation actions and receptionist tools share this one
// policy-gated, idempotent, ledgered path.
export async function executeAITool(input: { businessId: string; runId: string; name: string; config: unknown; idempotencyKey: string; approved?: boolean; workflowId?: string }) {
  const automationTool = allowed.has(input.name);
  const agentTool = isAgentTool(input.name);
  if (!automationTool && !agentTool) throw ApiError.forbidden("AI tool is not allowlisted");
  const config = z.record(z.string(), z.unknown()).parse(input.config ?? {});
  if (automationTool) {
    const errors = validateActionConfig(input.name, config);
    if (errors.length) throw ApiError.badRequest("Invalid AI tool request", errors);
  }
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

  const existing = await prisma.aIInvocationLedger.findFirst({ where: { businessId: input.businessId, correlationId: input.idempotencyKey, outcome: "TOOL_COMPLETED" } });
  if (existing) return { replayed: true };

  let result: unknown;
  if (agentTool) {
    const tool = getAgentTool(input.name)!;
    result = await tool.run(
      { businessId: input.businessId, runId: run.id, conversationId: run.conversationId, customerId: run.customerId ?? null },
      config,
    );
  } else {
    const handler = getAction(input.name);
    if (!handler) throw ApiError.serviceUnavailable("AI tool handler is not configured");
    result = await handler({ businessId: input.businessId, executionId: `ai:${run.id}`, nodeId: input.name, input: run.state, idempotencyKey: input.idempotencyKey, signal: AbortSignal.timeout(30_000) }, config);
  }
  await prisma.aIInvocationLedger.create({ data: { businessId: input.businessId, customerId: run.customerId, conversationId: run.conversationId, provider: "tool-broker", model: input.name, promptVersion: "tool-v1", promptChecksum: createHash("sha256").update(input.name).digest("hex"), correlationId: input.idempotencyKey, safetyResult: "PASSED", outcome: "TOOL_COMPLETED", approvalStatus: decision.effect, toolRequests: { name: input.name, policyDecisionId: decision.decisionId } } });
  // LOOP 3B-3: a successful tool result becomes running session memory.
  if (await getSession(input.businessId, run.id)) {
    await appendToolOutput(input.businessId, run.id, { name: input.name, output: (result as { output?: unknown })?.output ?? result });
  }
  emitAIEvent({ businessId: input.businessId, metric: "tool_usage", dimensions: { tool: input.name } });
  return result;
}
// LOOP 3B-3: the Memory Platform supplies trusted, attributed context. The
// runtime retrieves memory before intent classification, planning, tool
// selection and response generation; retrieval is deterministic and every
// item names its source. Session memory tracks the run; conversation memory
// (AI decisions, intents, resolutions) and an extractive summary are written
// as the run reaches a terminal state.
export async function advanceAIConversation(input: { businessId: string; runId: string; prompt: string; mode?: "DRAFT" | "APPROVAL" | "AUTONOMOUS" }) {
  const run = await prisma.aIConversationRun.findFirst({ where: { id: input.runId, businessId: input.businessId } });
  if (!run) throw ApiError.notFound("AI conversation run not found");

  await ensureSession({ businessId: input.businessId, runId: run.id, conversationId: run.conversationId, customerId: run.customerId ?? undefined, ttlMinutes: 60 });

  const memoryCommon = { businessId: input.businessId, runId: run.id, conversationId: run.conversationId, customerId: run.customerId ?? undefined, query: input.prompt } as const;
  const retrieval: Partial<Record<RetrievalPhase, RetrievalResult>> = {};

  retrieval.INTENT = await retrieveMemory({ ...memoryCommon, phase: "INTENT" });
  await prisma.aIConversationRun.update({ where: { id: run.id }, data: { status: "CONTEXT_READY" } });
  await prisma.aIConversationRun.update({ where: { id: run.id }, data: { status: "CLASSIFIED" } });

  retrieval.PLANNING = await retrieveMemory({ ...memoryCommon, phase: "PLANNING" });
  await prisma.aIConversationRun.update({ where: { id: run.id }, data: { status: "PLANNED" } });

  retrieval.TOOL_SELECTION = await retrieveMemory({ ...memoryCommon, phase: "TOOL_SELECTION" });
  await prisma.aIConversationRun.update({ where: { id: run.id }, data: { status: "TOOL_SELECTION" } });

  retrieval.RESPONSE = await retrieveMemory({ ...memoryCommon, phase: "RESPONSE" });
  await prisma.aIConversationRun.update({ where: { id: run.id }, data: { status: "DRAFT_RESPONSE" } });

  const memoryContext = {
    intent: retrieval.INTENT.items.map((item) => ({ scope: item.scope, kind: item.kind, source: item.source, content: item.content })),
    planning: retrieval.PLANNING.items.map((item) => ({ scope: item.scope, kind: item.kind, source: item.source, content: item.content })),
    toolSelection: retrieval.TOOL_SELECTION.items.map((item) => ({ scope: item.scope, kind: item.kind, source: item.source, content: item.content })),
    response: retrieval.RESPONSE.items.map((item) => ({ scope: item.scope, kind: item.kind, source: item.source, content: item.content })),
  };
  const retrievalMetrics = Object.fromEntries(
    (Object.entries(retrieval) as Array<[RetrievalPhase, RetrievalResult]>).map(([phase, result]) => [phase, result.metrics]),
  );
  await setSessionContext(input.businessId, run.id, { lastPrompt: input.prompt, retrieval: retrievalMetrics });

  const context = {
    ...(await businessAIContext(input.businessId, run.customerId ?? undefined)),
    memory: memoryContext,
    memoryDigest: formatMemoryForContext(retrieval.RESPONSE.items),
  };
  const resolved = await renderPublishedPrompt({ templateKey: "conversation.orchestrator", businessId: input.businessId, values: { message: input.prompt } });
  const response = await routeAI({ businessId: input.businessId, customerId: run.customerId ?? undefined, conversationId: run.conversationId, runId: run.id, task: "conversation", prompt: resolved.rendered.prompt, context, promptVersionId: resolved.versionId, requiredCapability: resolved.requiredCapability ?? "conversation" });

  // LOOP 3B-2: the drafted reply is cleared by the Policy Engine at the
  // CUSTOMER_RESPONSE checkpoint. The decision — not the caller — sets the
  // terminal state.
  const outputText = typeof response.output === "string" ? response.output : JSON.stringify(response.output);
  const decision = await evaluatePolicy({ businessId: input.businessId, checkpoint: "CUSTOMER_RESPONSE", action: "reply", runId: run.id, conversationId: run.conversationId, customerId: run.customerId ?? undefined, confidence: response.confidence, outputText });
  const next = decision.effect === "DENY" ? "FAILED" : decision.effect === "ESCALATE" ? "ESCALATED" : decision.effect === "REQUIRE_APPROVAL" || input.mode === "APPROVAL" ? "HUMAN_APPROVAL" : "COMPLETED";

  await recordConversationEvent({ businessId: input.businessId, conversationId: run.conversationId, runId: run.id, customerId: run.customerId ?? undefined, kind: "ai_decision", content: `AI drafted a reply; policy outcome ${decision.effect}, run ${next}.`, data: { policyDecisionId: decision.decisionId, confidence: response.confidence ?? null } });
  if (next === "COMPLETED" || next === "ESCALATED" || next === "FAILED") {
    await recordConversationEvent({ businessId: input.businessId, conversationId: run.conversationId, runId: run.id, customerId: run.customerId ?? undefined, kind: "resolution", content: `Run ${run.id.slice(0, 8)} reached ${next}.`, data: { outcome: next } });
    await summarizeConversation({ businessId: input.businessId, conversationId: run.conversationId, runId: run.id, customerId: run.customerId ?? undefined, outcome: next });
  }

  return prisma.aIConversationRun.update({
    where: { id: run.id },
    data: {
      status: next,
      mode: input.mode ?? decision.mode ?? run.mode,
      lastError: decision.effect === "DENY" ? decision.reasons.map((reason) => reason.message).join("; ") : null,
      state: {
        context,
        response: response.output,
        promptVersionId: resolved.versionId,
        ledgerId: response.ledgerId,
        policyDecisionId: decision.decisionId,
        policyOutcome: decision.effect,
        retrievalMetrics,
      } as never,
    },
  });
}
