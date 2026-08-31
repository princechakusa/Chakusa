import { prisma } from "../../prisma.js";
import { ApiError } from "../../errors.js";
import { captureUnexpectedError } from "../../sentry.js";
import { routeAI } from "../aiGateway.js";
import { renderPublishedPrompt } from "../promptRegistry.js";
import { evaluatePolicy, resolveActivePolicy } from "../policyEngine.js";
import { retrieveMemory, formatMemoryForContext } from "../memory/retrievalEngine.js";
import { ensureSession } from "../memory/memoryStore.js";
import { recordConversationEvent } from "../memory/summarization.js";
import { writeMemory } from "../memory/memoryStore.js";
import { executeAITool } from "../aiRuntime.js";
import { notifyCustomer } from "../../customer/customerNotifications.js";
import { isCustomerAssistantTool, customerAssistantToolManifest } from "./customerAssistantTools.js";
import { buildCustomerAssistantContext } from "./context.js";

// PROGRAM 2 LOOP 4 — the Customer AI Assistant orchestrator. It composes the
// EXISTING AI Platform primitives exactly the way runCustomerAgentTurn does
// for the business side: memory retrieval, a PUBLISHED orchestrator prompt,
// routeAI (Policy INVOCATION + circuit breaker + ledger), the Tool Broker
// (executeAITool, toolset "customer"), the CUSTOMER_RESPONSE policy
// checkpoint, conversation memory + summarization. It implements no AI logic
// of its own and never calls a provider directly.

const MAX_TOOL_ITERATIONS = 4;
const ASSISTANT_TEMPLATE_KEY = "customer.assistant.orchestrator";

let promptEnsured = false;

/** Idempotently makes sure a PUBLISHED customer-assistant orchestrator prompt exists. */
export async function ensureCustomerAssistantPrompt(): Promise<void> {
  if (promptEnsured) return;
  const existing = await prisma.promptTemplate.findFirst({
    where: { key: ASSISTANT_TEMPLATE_KEY, package: { scope: "PLATFORM" } },
    select: { id: true, currentVersionId: true },
  });
  if (existing?.currentVersionId) {
    const v = await prisma.promptVersion.findUnique({ where: { id: existing.currentVersionId }, select: { status: true } });
    if (v?.status === "PUBLISHED") { promptEnsured = true; return; }
  }

  const pkg =
    (await prisma.promptPackage.findFirst({ where: { key: "platform", scope: "PLATFORM" }, select: { id: true } })) ??
    (await prisma.promptPackage.create({ data: { key: "platform", name: "Platform", scope: "PLATFORM", status: "PUBLISHED" } }));

  const template =
    existing ??
    (await prisma.promptTemplate.create({ data: { packageId: pkg.id, key: ASSISTANT_TEMPLATE_KEY, name: "Customer AI Assistant Orchestrator", task: "conversation" } }));

  const last = await prisma.promptVersion.findFirst({ where: { templateId: template.id }, orderBy: { version: "desc" }, select: { version: true } });
  const version = await prisma.promptVersion.create({
    data: {
      templateId: template.id,
      version: (last?.version ?? 0) + 1,
      status: "PUBLISHED",
      body:
        "You are the Chakusa customer assistant. Help this customer with their bookings, favourite businesses and services, reviews, and finding businesses in the marketplace. " +
        "Use only the provided tools and context — never invent a business, service, price or time. When the customer asks to book, move or cancel an appointment, confirm the specifics first, then call the matching tool. " +
        "Customer message: {{message}}",
      requiredCapability: "conversation",
      checksum: `seed-${ASSISTANT_TEMPLATE_KEY}-${(last?.version ?? 0) + 1}`,
      publishedAt: new Date(),
      variables: { create: [{ name: "message", required: true }] },
    },
  });
  await prisma.promptTemplate.update({ where: { id: template.id }, data: { currentVersionId: version.id, status: "PUBLISHED" } });
  promptEnsured = true;
}

/** Test hook — forces the next turn to re-check the prompt. */
export function resetCustomerAssistantPromptCache() {
  promptEnsured = false;
}

/**
 * Resolves the anchor business a turn runs against. The assistant is
 * customer-scoped, but routeAI / the Policy Engine / the ledger are
 * business-scoped, so every turn attaches to one business: the conversation's
 * bound business, else the customer's most recent booking / favourite /
 * viewed business.
 */
export async function resolveAnchorBusiness(customerProfileId: string, preferBusinessId?: string | null): Promise<{ businessId: string; businessCustomerId: string | null } | null> {
  const candidateIds: string[] = [];
  if (preferBusinessId) candidateIds.push(preferBusinessId);

  const [recentAppt, links, recentView] = await Promise.all([
    prisma.appointment.findFirst({ where: { bookedByCustomerProfileId: customerProfileId }, orderBy: { createdAt: "desc" }, select: { businessId: true } }),
    prisma.customerBusinessLink.findMany({ where: { customerProfileId }, orderBy: [{ favourite: "desc" }, { lastInteractionAt: "desc" }], take: 5, select: { businessId: true, businessCustomerId: true } }),
    prisma.customerBusinessView.findFirst({ where: { customerProfileId }, orderBy: { viewedAt: "desc" }, select: { businessId: true } }),
  ]);
  if (recentAppt) candidateIds.push(recentAppt.businessId);
  for (const link of links) candidateIds.push(link.businessId);
  if (recentView) candidateIds.push(recentView.businessId);

  const linkById = new Map(links.map((l) => [l.businessId, l.businessCustomerId]));
  for (const businessId of candidateIds) {
    const business = await prisma.business.findFirst({ where: { id: businessId, platformStatus: "ACTIVE" }, select: { id: true } });
    if (business) return { businessId, businessCustomerId: linkById.get(businessId) ?? null };
  }
  return null;
}

export interface AssistantTurnResult {
  runId: string;
  status: "COMPLETED" | "ESCALATED" | "FAILED";
  replyText: string;
  toolResults: Array<{ tool: string; ok: boolean; output?: unknown; error?: string; denied?: boolean }>;
  policyOutcome: string;
  policyDecisionId: string;
  anchorBusinessId: string;
}

function coerceReplyText(output: unknown): string {
  if (typeof output === "string") return output.trim();
  if (output && typeof output === "object") {
    const text = (output as { text?: unknown; message?: unknown }).text ?? (output as { message?: unknown }).message;
    if (typeof text === "string") return text.trim();
  }
  return typeof output === "undefined" ? "" : JSON.stringify(output);
}

/** One turn of the Customer AI Assistant. `conversationId` is a CustomerAIConversation.id. */
export async function runCustomerAssistantTurn(input: {
  customerProfileId: string;
  conversationId: string;
  messageId: string;
  prompt: string;
  preferBusinessId?: string | null;
}): Promise<AssistantTurnResult> {
  await ensureCustomerAssistantPrompt();

  const anchor = await resolveAnchorBusiness(input.customerProfileId, input.preferBusinessId);
  if (!anchor) {
    throw ApiError.badRequest("The assistant needs a business to work with — favourite a business or make a booking first.");
  }
  const { businessId, businessCustomerId } = anchor;

  const activePolicy = await resolveActivePolicy(businessId);
  const idempotencyKey = `customer-assistant:${input.conversationId}:${input.messageId}`;
  const existingRun = await prisma.aIConversationRun.findUnique({ where: { idempotencyKey }, select: { id: true } });
  const run = existingRun
    ? await prisma.aIConversationRun.findUniqueOrThrow({ where: { id: existingRun.id } })
    : await prisma.aIConversationRun.create({
        data: { businessId, customerId: businessCustomerId, conversationId: input.conversationId, idempotencyKey, status: "RECEIVED", mode: activePolicy.mode },
      });

  await ensureSession({ businessId, runId: run.id, conversationId: input.conversationId, customerId: businessCustomerId ?? undefined, ttlMinutes: 60 });

  const settings = await prisma.customerProfile.findUniqueOrThrow({
    where: { id: input.customerProfileId },
    select: { privacySettings: true, communicationPreferences: true },
  });
  const memoryEnabled = ((settings.communicationPreferences ?? {}) as Record<string, { memoryEnabled?: boolean }>).assistant?.memoryEnabled !== false;

  const memory = memoryEnabled
    ? await retrieveMemory({ businessId, phase: "RESPONSE", runId: run.id, conversationId: input.conversationId, customerId: businessCustomerId ?? undefined, query: input.prompt })
    : { items: [] as never[] };
  const assistantContext = await buildCustomerAssistantContext(input.customerProfileId);
  const resolved = await renderPublishedPrompt({ templateKey: ASSISTANT_TEMPLATE_KEY, values: { message: input.prompt } });

  const advance = (status: string) => prisma.aIConversationRun.update({ where: { id: run.id }, data: { status } });
  await advance("CONTEXT_READY");
  await advance("PLANNED");
  await advance("TOOL_SELECTION");

  const toolResults: AssistantTurnResult["toolResults"] = [];
  let replyText = "";

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const context = {
      assistant: assistantContext,
      tools: customerAssistantToolManifest(),
      memoryDigest: formatMemoryForContext(memory.items as never),
      toolResults,
    };
    const turnPrompt = toolResults.length
      ? `${resolved.rendered.prompt}\n\nTool results so far:\n${JSON.stringify(toolResults)}`
      : resolved.rendered.prompt;

    const response = await routeAI({
      businessId,
      customerId: businessCustomerId ?? undefined,
      conversationId: input.conversationId,
      runId: run.id,
      task: "conversation",
      prompt: turnPrompt,
      context,
      promptVersionId: resolved.versionId,
      requiredCapability: resolved.requiredCapability ?? "conversation",
    });

    const requests = response.toolRequests ?? [];
    if (!requests.length) {
      replyText = coerceReplyText(response.output);
      break;
    }

    await advance("TOOL_EXECUTION");
    for (const request of requests) {
      const name = String(request.name);
      if (!isCustomerAssistantTool(name)) {
        toolResults.push({ tool: name, ok: false, error: "unknown tool" });
        continue;
      }
      try {
        const output = await executeAITool({
          businessId,
          runId: run.id,
          name,
          config: (request.arguments ?? {}) as Record<string, unknown>,
          idempotencyKey: `customer-assistant:${run.id}:${iteration}:${name}`,
          toolset: "customer",
          customerProfileId: input.customerProfileId,
        });
        toolResults.push({ tool: name, ok: true, output: (output as { output?: unknown })?.output ?? output });
      } catch (error) {
        const code = (error as { code?: string })?.code;
        if (code === "POLICY_DENIED" || code === "POLICY_APPROVAL_REQUIRED") {
          toolResults.push({ tool: name, ok: false, error: (error as Error).message, denied: true });
        } else {
          toolResults.push({ tool: name, ok: false, error: (error as Error).message ?? "tool failed" });
        }
      }
    }
  }

  await advance("DRAFT_RESPONSE");

  const decision = await evaluatePolicy({
    businessId,
    checkpoint: "CUSTOMER_RESPONSE",
    action: "reply",
    runId: run.id,
    conversationId: input.conversationId,
    customerId: businessCustomerId ?? undefined,
    outputText: replyText,
  });

  const status: AssistantTurnResult["status"] =
    decision.effect === "DENY" ? "FAILED" : decision.effect === "ESCALATE" ? "ESCALATED" : "COMPLETED";
  if (status === "FAILED" && !replyText) {
    replyText = "Sorry — I can't help with that request.";
  }

  await recordConversationEvent({
    businessId,
    conversationId: input.conversationId,
    runId: run.id,
    customerId: businessCustomerId ?? undefined,
    kind: "ai_decision",
    content: `Customer Assistant turn: ${toolResults.length} tool call(s), policy ${decision.effect}, run ${status}.`,
    data: { policyDecisionId: decision.decisionId, tools: toolResults.map((t) => t.tool) },
  });
  if (memoryEnabled) {
    await recordConversationEvent({ businessId, conversationId: input.conversationId, runId: run.id, customerId: businessCustomerId ?? undefined, kind: "resolution", content: `Assistant run reached ${status}.`, data: { outcome: status } }).catch(() => undefined);
    await summarizeConversationSafe(businessId, input.conversationId, run.id, businessCustomerId, status);
  }

  await prisma.aIConversationRun.update({
    where: { id: run.id },
    data: {
      status,
      mode: decision.mode ?? run.mode,
      lastError: status === "FAILED" ? decision.reasons.map((r) => r.message).join("; ") : null,
      state: { response: replyText, toolResults, policyDecisionId: decision.decisionId, policyOutcome: decision.effect, anchorBusinessId: businessId } as never,
    },
  });

  return { runId: run.id, status, replyText, toolResults, policyOutcome: decision.effect, policyDecisionId: decision.decisionId, anchorBusinessId: businessId };
}

async function summarizeConversationSafe(businessId: string, conversationId: string, runId: string, customerId: string | null, outcome: string) {
  try {
    // The customer-assistant thread has no Message rows; write a lightweight
    // CONVERSATION summary directly so future turns can retrieve it.
    const thread = await prisma.customerAIMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, take: 12, select: { role: true, content: true } });
    if (!thread.length) return;
    const first = thread.find((m) => m.role === "user");
    const tail = thread.slice(-4);
    const text =
      (first ? `Opened with: "${first.content.slice(0, 160)}". ` : "") +
      `Latest: ${tail.map((m) => `${m.role}: ${m.content.slice(0, 120)}`).join(" | ")}. Outcome ${outcome}.`;
    await writeMemory({
      businessId,
      scope: "CONVERSATION",
      kind: "summary",
      title: "Assistant conversation summary",
      content: text,
      conversationId,
      customerId: customerId ?? null,
      runId,
      source: "customer-assistant-summarizer",
      sourceRef: conversationId,
      importance: 0.7,
      supersedeMatching: true,
    });
  } catch (error) {
    captureUnexpectedError(error);
  }
}

export async function notifyAssistantReply(customerProfileId: string, businessId: string, conversationId: string, replyText: string) {
  await notifyCustomer({
    customerProfileId,
    category: "ai_reply",
    title: "Assistant replied",
    body: replyText.slice(0, 140) || "Your assistant has a response.",
    businessId,
    data: { conversationId },
  }).catch(() => undefined);
}
