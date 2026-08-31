import type { Plan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { captureUnexpectedError } from "../../sentry.js";
import { enqueueMessage } from "../../messaging/messagingPlatform.js";
import { businessAIContext, routeAI } from "../aiGateway.js";
import { renderPublishedPrompt } from "../promptRegistry.js";
import { evaluatePolicy, resolveActivePolicy } from "../policyEngine.js";
import { retrieveMemory, formatMemoryForContext } from "../memory/retrievalEngine.js";
import { ensureSession } from "../memory/memoryStore.js";
import { recordConversationEvent, summarizeConversation } from "../memory/summarization.js";
import { executeAITool } from "../aiRuntime.js";
import { isAgentTool } from "./agentTools.js";

const MAX_TOOL_ITERATIONS = 4;

export interface AgentTurnResult {
  runId: string;
  status: "COMPLETED" | "HUMAN_APPROVAL" | "ESCALATED" | "FAILED";
  replyText: string;
  toolResults: Array<{ tool: string; ok: boolean; output?: unknown; error?: string; denied?: boolean }>;
  policyDecisionId: string;
  approvalRequired?: boolean;
}

function coerceReplyText(output: unknown): string {
  if (typeof output === "string") return output.trim();
  if (output && typeof output === "object") {
    const text = (output as { text?: unknown; message?: unknown }).text ?? (output as { message?: unknown }).message;
    if (typeof text === "string") return text.trim();
  }
  return typeof output === "undefined" ? "" : JSON.stringify(output);
}

/**
 * One production turn of the AI Customer Agent. Composes the completed AI
 * Platform primitives — memory retrieval, the published orchestrator prompt,
 * routeAI (Policy Engine INVOCATION + circuit breaker + ledger), the Tool
 * Broker (executeAITool), the CUSTOMER_RESPONSE policy checkpoint,
 * conversation memory and summarization. It does not modify any of them.
 */
export async function runCustomerAgentTurn(input: {
  businessId: string;
  runId: string;
  prompt: string;
  channel?: string;
}): Promise<AgentTurnResult> {
  const run = await prisma.aIConversationRun.findFirst({ where: { id: input.runId, businessId: input.businessId } });
  if (!run) throw new Error("AI conversation run not found");

  await ensureSession({ businessId: input.businessId, runId: run.id, conversationId: run.conversationId, customerId: run.customerId ?? undefined, ttlMinutes: 60 });

  const memory = await retrieveMemory({
    businessId: input.businessId,
    phase: "RESPONSE",
    runId: run.id,
    conversationId: run.conversationId,
    customerId: run.customerId ?? undefined,
    query: input.prompt,
  });
  const resolved = await renderPublishedPrompt({ templateKey: "conversation.orchestrator", businessId: input.businessId, values: { message: input.prompt } });

  const advance = (status: string) => prisma.aIConversationRun.update({ where: { id: run.id }, data: { status } });
  await advance("CONTEXT_READY");
  await advance("CLASSIFIED");
  await advance("PLANNED");
  await advance("TOOL_SELECTION");

  const toolResults: AgentTurnResult["toolResults"] = [];
  let replyText = "";
  let approvalRequired = false;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const context = {
      ...(await businessAIContext(input.businessId, run.customerId ?? undefined)),
      memoryDigest: formatMemoryForContext(memory.items),
      toolResults,
    };
    const turnPrompt = toolResults.length
      ? `${resolved.rendered.prompt}\n\nTool results so far:\n${JSON.stringify(toolResults)}`
      : resolved.rendered.prompt;

    const response = await routeAI({
      businessId: input.businessId,
      customerId: run.customerId ?? undefined,
      conversationId: run.conversationId,
      runId: run.id,
      task: "conversation",
      prompt: turnPrompt,
      context,
      channel: input.channel,
      promptVersionId: resolved.versionId,
      requiredCapability: resolved.requiredCapability ?? "conversation",
    });

    const requests = response.toolRequests ?? [];
    if (!requests.length) {
      replyText = coerceReplyText(response.output);
      break;
    }

    await advance("TOOL_EXECUTION");
    let escalatedByTool = false;
    for (const request of requests) {
      const name = String(request.name);
      if (!isAgentTool(name)) {
        toolResults.push({ tool: name, ok: false, error: "unknown tool" });
        continue;
      }
      try {
        const output = await executeAITool({
          businessId: input.businessId,
          runId: run.id,
          name,
          config: request.arguments ?? {},
          idempotencyKey: `agent:${run.id}:${iteration}:${name}`,
        });
        toolResults.push({ tool: name, ok: true, output: (output as { output?: unknown })?.output ?? output });
        if (name === "escalate_to_human") escalatedByTool = true;
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code === "POLICY_APPROVAL_REQUIRED") {
          approvalRequired = true;
          toolResults.push({ tool: name, ok: false, error: "approval required", denied: true });
        } else if (code === "POLICY_DENIED") {
          toolResults.push({ tool: name, ok: false, error: (error as Error).message, denied: true });
        } else {
          toolResults.push({ tool: name, ok: false, error: (error as Error).message ?? "tool failed" });
        }
      }
    }
    if (escalatedByTool) {
      replyText = replyText || "Let me get a team member to help you with that.";
      break;
    }
    if (approvalRequired) {
      replyText = replyText || coerceReplyText("");
      break;
    }
  }

  await advance("DRAFT_RESPONSE");

  const decision = await evaluatePolicy({
    businessId: input.businessId,
    checkpoint: "CUSTOMER_RESPONSE",
    action: "reply",
    runId: run.id,
    conversationId: run.conversationId,
    customerId: run.customerId ?? undefined,
    channel: input.channel,
    outputText: replyText,
  });

  const escalated = toolResults.some((entry) => entry.tool === "escalate_to_human" && entry.ok);
  let status: AgentTurnResult["status"];
  if (decision.effect === "DENY") status = "FAILED";
  else if (decision.effect === "ESCALATE" || escalated) status = "ESCALATED";
  else if (decision.effect === "REQUIRE_APPROVAL" || approvalRequired) status = "HUMAN_APPROVAL";
  else status = "COMPLETED";

  await recordConversationEvent({
    businessId: input.businessId,
    conversationId: run.conversationId,
    runId: run.id,
    customerId: run.customerId ?? undefined,
    kind: "ai_decision",
    content: `Customer Agent turn: ${toolResults.length} tool call(s), policy ${decision.effect}, run ${status}.`,
    data: { policyDecisionId: decision.decisionId, tools: toolResults.map((entry) => entry.tool) },
  });
  if (status === "COMPLETED" || status === "ESCALATED" || status === "FAILED") {
    await recordConversationEvent({ businessId: input.businessId, conversationId: run.conversationId, runId: run.id, customerId: run.customerId ?? undefined, kind: "resolution", content: `Run reached ${status}.`, data: { outcome: status } });
    await summarizeConversation({ businessId: input.businessId, conversationId: run.conversationId, runId: run.id, customerId: run.customerId ?? undefined, outcome: status });
  }

  await prisma.aIConversationRun.update({
    where: { id: run.id },
    data: {
      status,
      mode: decision.mode ?? run.mode,
      lastError: status === "FAILED" ? decision.reasons.map((reason) => reason.message).join("; ") : null,
      state: {
        response: replyText,
        toolResults,
        policyDecisionId: decision.decisionId,
        policyOutcome: decision.effect,
        pendingReply: status === "HUMAN_APPROVAL" ? replyText : null,
        channel: input.channel ?? null,
      } as never,
    },
  });

  return { runId: run.id, status, replyText, toolResults, policyDecisionId: decision.decisionId, approvalRequired };
}

// ---------------------------------------------------------------------------
// Live conversation integration
// ---------------------------------------------------------------------------

export interface InboundAIResult {
  handled: boolean;
  reason?: string;
  runId?: string;
  status?: string;
  replySent?: boolean;
  draftHeld?: boolean;
  replayed?: boolean;
}

/** Feature-flag gate — the agent only runs for businesses that opted in. */
export async function isCustomerAgentEnabled(businessId: string): Promise<boolean> {
  const flag = await prisma.featureFlag.findFirst({
    where: { key: "ai.customer_agent", enabled: true, OR: [{ scope: "PLATFORM" }, { scope: "BUSINESS", businessId }] },
    select: { id: true },
  });
  return Boolean(flag);
}

/**
 * Entry point from the Messaging Platform's inbound path. Creates one
 * idempotent AIConversationRun per inbound message, runs a Customer Agent
 * turn, and routes the outcome: autonomous replies go out through
 * enqueueMessage (the existing durable send), held drafts become a draft
 * Message for human review, escalations flip the conversation to HUMAN.
 * Any failure is swallowed so the inbound webhook still acks.
 */
export async function handleInboundAIMessage(input: {
  businessId: string;
  conversationId: string;
  customerId: string;
  /** The provider's stable message id — used as the run idempotency key so a provider retry replays. */
  providerMessageId: string;
  channel: "sms" | "whatsapp";
  body: string;
}): Promise<InboundAIResult> {
  if (!(await isCustomerAgentEnabled(input.businessId))) return { handled: false, reason: "agent_disabled" };

  const conversation = await prisma.conversation.findFirst({
    where: { id: input.conversationId, businessId: input.businessId },
    select: { automationMode: true },
  });
  if (!conversation) return { handled: false, reason: "conversation_not_found" };
  if (conversation.automationMode !== "AUTOMATED") return { handled: false, reason: "human_owned" };

  const idempotencyKey = `ai-agent:${input.businessId}:${input.providerMessageId}`;
  const existing = await prisma.aIConversationRun.findUnique({ where: { idempotencyKey }, select: { id: true, status: true } });
  if (existing) return { handled: true, runId: existing.id, status: existing.status, replayed: true };

  const subscription = await prisma.subscription.findUnique({ where: { businessId: input.businessId }, select: { plan: true, status: true } });
  const plan: Plan = subscription?.plan ?? "FREE";
  const status: SubscriptionStatus = subscription?.status ?? "ACTIVE";
  const activePolicy = await resolveActivePolicy(input.businessId);

  const run = await prisma.aIConversationRun.create({
    data: { businessId: input.businessId, customerId: input.customerId, conversationId: input.conversationId, idempotencyKey, status: "RECEIVED", mode: activePolicy.mode },
  });

  let turn: AgentTurnResult;
  try {
    turn = await runCustomerAgentTurn({ businessId: input.businessId, runId: run.id, prompt: input.body, channel: input.channel });
  } catch (error) {
    captureUnexpectedError(error);
    await prisma.aIConversationRun.update({ where: { id: run.id }, data: { status: "FAILED", lastError: (error as Error).message?.slice(0, 500) ?? "agent error" } });
    return { handled: true, runId: run.id, status: "FAILED", replySent: false };
  }

  if (turn.status === "COMPLETED" && turn.replyText) {
    await deliverAIReply({ businessId: input.businessId, customerId: input.customerId, conversationId: input.conversationId, runId: run.id, body: turn.replyText, channel: input.channel, plan, status });
    return { handled: true, runId: run.id, status: "COMPLETED", replySent: true };
  }
  if (turn.status === "HUMAN_APPROVAL") {
    await holdAIDraft({ businessId: input.businessId, customerId: input.customerId, conversationId: input.conversationId, body: turn.replyText, channel: input.channel });
    return { handled: true, runId: run.id, status: "HUMAN_APPROVAL", replySent: false, draftHeld: true };
  }
  if (turn.status === "ESCALATED") {
    await escalateConversation({ businessId: input.businessId, conversationId: input.conversationId, runId: run.id, reason: "AI escalation" });
    return { handled: true, runId: run.id, status: "ESCALATED", replySent: false };
  }
  return { handled: true, runId: run.id, status: turn.status, replySent: false };
}

/** Sends an AI reply through the existing durable Messaging Platform send. */
export async function deliverAIReply(input: {
  businessId: string;
  customerId: string;
  conversationId: string;
  runId: string;
  body: string;
  channel: "sms" | "whatsapp";
  plan: Plan;
  status: SubscriptionStatus;
}) {
  const message = await enqueueMessage(
    {
      businessId: input.businessId,
      customerId: input.customerId,
      body: input.body,
      messageType: "custom",
      channel: input.channel,
      purpose: "SERVICE",
      actorType: "SYSTEM",
      idempotencyKey: `ai-reply:${input.runId}`,
      correlationId: input.runId,
    },
    input.plan,
    input.status,
  );
  await prisma.conversation.updateMany({ where: { id: input.conversationId, businessId: input.businessId }, data: { lastOutboundAt: new Date() } });
  await prisma.aIConversationRun.updateMany({ where: { id: input.runId }, data: { status: "COMPLETED" } });
  return message;
}

/** Persists the AI's proposed reply as a draft Message for human review. */
export async function holdAIDraft(input: {
  businessId: string;
  customerId: string;
  conversationId: string;
  body: string;
  channel: "sms" | "whatsapp";
}) {
  return prisma.message.create({
    data: {
      businessId: input.businessId,
      customerId: input.customerId,
      conversationId: input.conversationId,
      messageType: "custom",
      channel: input.channel,
      body: input.body || "(no draft produced)",
      status: "draft",
      direction: "OUTBOUND",
      actorType: "AI",
      purpose: "SERVICE",
      contents: { create: { businessId: input.businessId, contentType: "TEXT", body: input.body || "(no draft produced)" } },
    },
  });
}

export async function escalateConversation(input: { businessId: string; conversationId: string; runId?: string; reason: string }) {
  await prisma.conversation.updateMany({
    where: { id: input.conversationId, businessId: input.businessId },
    data: { automationMode: "HUMAN", status: "PENDING", waitingSince: new Date() },
  });
  await prisma.conversationLifecycleEvent.create({
    data: { businessId: input.businessId, conversationId: input.conversationId, type: "AI_ESCALATED", metadata: { reason: input.reason, runId: input.runId ?? null } },
  });
}
