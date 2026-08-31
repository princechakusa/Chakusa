import { createHash } from "node:crypto";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { assertSafeAIInput } from "./safety.js";
import { assertPolicyAllows } from "./policyEngine.js";
import { guardProvider, recordProviderResult } from "./ops/circuitBreaker.js";
import { emitAIEvent } from "./ops/aiMetrics.js";

export { assertSafeAIInput } from "./safety.js";

export type AITask = "classification" | "conversation" | "scheduling" | "extraction";
export interface AIProvider { id: string; invoke(input: { model: string; task: AITask; prompt: string; context: unknown; tools: Array<{ name: string; schema: object }> }): Promise<{ output: unknown; confidence?: number; usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number }; toolRequests?: Array<{ name: string; arguments: unknown }> }> }
const providers = new Map<string, AIProvider>();
export function registerAIProvider(provider: AIProvider) { providers.set(provider.id, provider); }
export function clearAIProviders() { providers.clear(); }
export function listAIProviderIds() { return [...providers.keys()]; }

// LOOP 3B-1: routeAI() will only execute a prompt that resolves to an
// immutable, PUBLISHED PromptVersion — callers pass its id and the gateway
// re-checks status here so an unpublished or retired reference can never
// reach a model. The version's declared requiredCapability is honored when
// the caller does not override it.
// LOOP 3B-2: every invocation is first cleared by the Policy Engine at the
// INVOCATION checkpoint — a DENY (kill switch, injection, cross-tenant,
// business restriction) throws before any provider call or ledger write.
// LOOP 5 hardening: the Policy Engine INVOCATION check is now unconditional —
// there is no bypass parameter. Nothing can reach a provider without a
// policy decision on record.
export async function routeAI(input: { businessId: string; task: AITask; prompt: string; context: unknown; customerId?: string; conversationId?: string; workflowExecutionId?: string; runId?: string; correlationId?: string; causationId?: string; promptVersionId: string; requiredCapability?: string; channel?: string }) {
  assertSafeAIInput(input.prompt);
  await assertPolicyAllows({
    businessId: input.businessId,
    checkpoint: "INVOCATION",
    action: input.task,
    customerId: input.customerId,
    conversationId: input.conversationId,
    workflowExecutionId: input.workflowExecutionId,
    runId: input.runId,
    channel: input.channel,
    promptText: input.prompt,
    correlationId: input.correlationId,
  });
  const promptVersion = await prisma.promptVersion.findUnique({ where: { id: input.promptVersionId }, select: { id: true, status: true, requiredCapability: true } });
  if (!promptVersion) throw ApiError.badRequest("routeAI requires a known prompt version");
  if (promptVersion.status !== "PUBLISHED") throw ApiError.badRequest("routeAI requires a published prompt version");
  const requiredCapability = input.requiredCapability ?? promptVersion.requiredCapability ?? undefined;
  const models = await prisma.aIModelRegistry.findMany({ where: { status: "ACTIVE", healthStatus: { in: ["HEALTHY", "UNKNOWN"] } } });
  const selected = models.find(row => !requiredCapability || (Array.isArray(row.capabilities) && row.capabilities.includes(requiredCapability)));
  if (!selected) throw ApiError.serviceUnavailable("No approved AI model is available");
  const provider = providers.get(selected.provider);
  if (!provider) throw ApiError.serviceUnavailable("AI provider adapter is not configured");
  // LOOP 3B-4: circuit breaker + operational metrics around every provider call.
  guardProvider(selected.provider, selected.model);
  emitAIEvent({ businessId: input.businessId, metric: "routing_decisions", provider: selected.provider, model: selected.model });
  emitAIEvent({ businessId: input.businessId, metric: "prompt_usage", dimensions: { promptVersionId: promptVersion.id } });
  const started = Date.now();
  const checksum = createHash("sha256").update(input.prompt).digest("hex");
  try {
    const result = await provider.invoke({ model: selected.model, task: input.task, prompt: input.prompt, context: input.context, tools: [] });
    const latencyMs = Date.now() - started;
    const ledger = await prisma.aIInvocationLedger.create({ data: { businessId: input.businessId, customerId: input.customerId, conversationId: input.conversationId, workflowExecutionId: input.workflowExecutionId, provider: selected.provider, model: selected.model, modelVersion: selected.version, promptVersion: promptVersion.id, promptChecksum: checksum, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens, reasoningTokens: result.usage?.reasoningTokens, latencyMs, correlationId: input.correlationId, causationId: input.causationId, confidence: result.confidence, safetyResult: "PASSED", outcome: "COMPLETED", toolRequests: (result.toolRequests ?? []) as never } });
    await recordProviderResult({ provider: selected.provider, model: selected.model, ok: true, latencyMs });
    emitAIEvent({ businessId: input.businessId, metric: "ai_requests", provider: selected.provider, model: selected.model });
    emitAIEvent({ businessId: input.businessId, metric: "latency_ms", value: latencyMs, provider: selected.provider, model: selected.model });
    emitAIEvent({ businessId: input.businessId, metric: "tokens_input", value: result.usage?.inputTokens ?? 0, provider: selected.provider, model: selected.model });
    emitAIEvent({ businessId: input.businessId, metric: "tokens_output", value: result.usage?.outputTokens ?? 0, provider: selected.provider, model: selected.model });
    return { ...result, provider: selected.provider, model: selected.model, promptVersionId: promptVersion.id, ledgerId: ledger.id };
  } catch (error) {
    const latencyMs = Date.now() - started;
    await prisma.aIInvocationLedger.create({ data: { businessId: input.businessId, customerId: input.customerId, conversationId: input.conversationId, workflowExecutionId: input.workflowExecutionId, provider: selected.provider, model: selected.model, modelVersion: selected.version, promptVersion: promptVersion.id, promptChecksum: checksum, latencyMs, correlationId: input.correlationId, causationId: input.causationId, safetyResult: "FAILED", outcome: "FAILED" } });
    await recordProviderResult({ provider: selected.provider, model: selected.model, ok: false, latencyMs, error: error instanceof Error ? error.message : "provider error" });
    emitAIEvent({ businessId: input.businessId, metric: "ai_requests", provider: selected.provider, model: selected.model });
    emitAIEvent({ businessId: input.businessId, metric: "ai_failures", provider: selected.provider, model: selected.model });
    emitAIEvent({ businessId: input.businessId, metric: "provider_failures", provider: selected.provider, model: selected.model });
    throw error;
  }
}
export async function businessAIContext(businessId: string, customerId?: string) { const [business, customer, services, appointments] = await Promise.all([prisma.business.findUnique({ where: { id: businessId }, select: { name:true, industry:true, timezone:true, workingHours:true, defaultServices:true, preferredTone:true } }), customerId ? prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { name:true, notes:true, customFields:true } }) : null, prisma.serviceOffering.findMany({ where: { businessId, active: true }, take: 30 }), customerId ? prisma.appointment.findMany({ where: { businessId, customerId }, orderBy: { startsAt: "desc" }, take: 10 }) : []]); return { business, customer, services, appointments }; }
