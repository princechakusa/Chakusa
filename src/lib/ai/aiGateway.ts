import { createHash } from "node:crypto";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";

export type AITask = "classification" | "conversation" | "scheduling" | "extraction";
export interface AIProvider { id: string; invoke(input: { model: string; task: AITask; prompt: string; context: unknown; tools: Array<{ name: string; schema: object }> }): Promise<{ output: unknown; confidence?: number; usage?: { inputTokens?: number; outputTokens?: number; reasoningTokens?: number }; toolRequests?: Array<{ name: string; arguments: unknown }> }> }
const providers = new Map<string, AIProvider>();
export function registerAIProvider(provider: AIProvider) { providers.set(provider.id, provider); }
export function clearAIProviders() { providers.clear(); }
export function listAIProviderIds() { return [...providers.keys()]; }
const injection = /ignore\s+(all\s+)?(previous|above)|system\s+prompt|reveal\s+(secret|instruction)|act\s+as/iu;
export function assertSafeAIInput(value: string) { if (injection.test(value)) throw ApiError.badRequest("Unsafe prompt content detected"); }

// LOOP 3B-1: routeAI() will only execute a prompt that resolves to an
// immutable, PUBLISHED PromptVersion — callers pass its id and the gateway
// re-checks status here so an unpublished or retired reference can never
// reach a model. The version's declared requiredCapability is honored when
// the caller does not override it.
export async function routeAI(input: { businessId: string; task: AITask; prompt: string; context: unknown; customerId?: string; conversationId?: string; workflowExecutionId?: string; correlationId?: string; causationId?: string; promptVersionId: string; requiredCapability?: string }) {
  assertSafeAIInput(input.prompt);
  const promptVersion = await prisma.promptVersion.findUnique({ where: { id: input.promptVersionId }, select: { id: true, status: true, requiredCapability: true } });
  if (!promptVersion) throw ApiError.badRequest("routeAI requires a known prompt version");
  if (promptVersion.status !== "PUBLISHED") throw ApiError.badRequest("routeAI requires a published prompt version");
  const requiredCapability = input.requiredCapability ?? promptVersion.requiredCapability ?? undefined;
  const models = await prisma.aIModelRegistry.findMany({ where: { status: "ACTIVE", healthStatus: { in: ["HEALTHY", "UNKNOWN"] } } });
  const selected = models.find(row => !requiredCapability || (Array.isArray(row.capabilities) && row.capabilities.includes(requiredCapability)));
  if (!selected) throw ApiError.serviceUnavailable("No approved AI model is available");
  const provider = providers.get(selected.provider);
  if (!provider) throw ApiError.serviceUnavailable("AI provider adapter is not configured");
  const started = Date.now();
  const checksum = createHash("sha256").update(input.prompt).digest("hex");
  try {
    const result = await provider.invoke({ model: selected.model, task: input.task, prompt: input.prompt, context: input.context, tools: [] });
    const ledger = await prisma.aIInvocationLedger.create({ data: { businessId: input.businessId, customerId: input.customerId, conversationId: input.conversationId, workflowExecutionId: input.workflowExecutionId, provider: selected.provider, model: selected.model, modelVersion: selected.version, promptVersion: promptVersion.id, promptChecksum: checksum, inputTokens: result.usage?.inputTokens, outputTokens: result.usage?.outputTokens, reasoningTokens: result.usage?.reasoningTokens, latencyMs: Date.now() - started, correlationId: input.correlationId, causationId: input.causationId, confidence: result.confidence, safetyResult: "PASSED", outcome: "COMPLETED", toolRequests: (result.toolRequests ?? []) as never } });
    return { ...result, provider: selected.provider, model: selected.model, promptVersionId: promptVersion.id, ledgerId: ledger.id };
  } catch (error) {
    await prisma.aIInvocationLedger.create({ data: { businessId: input.businessId, customerId: input.customerId, conversationId: input.conversationId, workflowExecutionId: input.workflowExecutionId, provider: selected.provider, model: selected.model, modelVersion: selected.version, promptVersion: promptVersion.id, promptChecksum: checksum, latencyMs: Date.now() - started, correlationId: input.correlationId, causationId: input.causationId, safetyResult: "FAILED", outcome: "FAILED" } });
    throw error;
  }
}
export async function businessAIContext(businessId: string, customerId?: string) { const [business, customer, services, appointments] = await Promise.all([prisma.business.findUnique({ where: { id: businessId }, select: { name:true, industry:true, timezone:true, workingHours:true, defaultServices:true, preferredTone:true } }), customerId ? prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { name:true, notes:true, customFields:true } }) : null, prisma.serviceOffering.findMany({ where: { businessId, active: true }, take: 30 }), customerId ? prisma.appointment.findMany({ where: { businessId, customerId }, orderBy: { startsAt: "desc" }, take: 10 }) : []]); return { business, customer, services, appointments }; }
