import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { getAIMonitoring } from "../../lib/ai/ops/aiMonitoring.js";
import { getAITrend } from "../../lib/ai/ops/aiMetrics.js";
import { circuitBreakerSnapshot } from "../../lib/ai/ops/circuitBreaker.js";
import { getAutomationFoundationStatus } from "../automation/automationFoundation.js";

// LOOP 3B-4: platform-wide (cross-tenant) AI administration reads. All are
// read-only except the model registry, which admins with `ai.manage` can
// edit. Reuses the same monitoring/trend libraries the tenant endpoints use.

export async function adminAIProviders() {
  const [models, health] = await Promise.all([
    prisma.aIModelRegistry.findMany({ orderBy: [{ provider: "asc" }, { model: "asc" }] }),
    prisma.aIProviderHealthCheck.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
  ]);
  const latest = new Map<string, (typeof health)[number]>();
  for (const check of health) {
    const key = `${check.provider}/${check.model ?? "*"}`;
    if (!latest.has(key)) latest.set(key, check);
  }
  return { models, circuitBreaker: circuitBreakerSnapshot(), health: [...latest.values()] };
}

export async function adminAIModels() {
  return prisma.aIModelRegistry.findMany({ orderBy: [{ provider: "asc" }, { model: "asc" }, { version: "asc" }] });
}

export async function adminUpsertAIModel(input: {
  provider: string;
  model: string;
  version: string;
  capabilities: string[];
  approvedUseCases: string[];
  pricing?: unknown;
  supportedLanguages?: unknown;
  status?: string;
}) {
  return prisma.aIModelRegistry.upsert({
    where: { provider_model_version: { provider: input.provider, model: input.model, version: input.version } },
    create: {
      provider: input.provider,
      model: input.model,
      version: input.version,
      capabilities: input.capabilities as Prisma.InputJsonValue,
      approvedUseCases: input.approvedUseCases as Prisma.InputJsonValue,
      pricing: (input.pricing ?? undefined) as Prisma.InputJsonValue | undefined,
      supportedLanguages: (input.supportedLanguages ?? undefined) as Prisma.InputJsonValue | undefined,
      status: input.status ?? "ACTIVE",
    },
    update: {
      capabilities: input.capabilities as Prisma.InputJsonValue,
      approvedUseCases: input.approvedUseCases as Prisma.InputJsonValue,
      pricing: (input.pricing ?? undefined) as Prisma.InputJsonValue | undefined,
      supportedLanguages: (input.supportedLanguages ?? undefined) as Prisma.InputJsonValue | undefined,
      ...(input.status ? { status: input.status } : {}),
    },
  });
}

export async function adminSetAIModelStatus(id: string, status: string, healthStatus?: string) {
  const existing = await prisma.aIModelRegistry.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Model registry entry not found");
  return prisma.aIModelRegistry.update({ where: { id }, data: { status, ...(healthStatus ? { healthStatus } : {}) } });
}

export async function adminAIRoutingRules() {
  const models = await prisma.aIModelRegistry.findMany({ where: { status: "ACTIVE" } });
  const byCapability: Record<string, Array<{ provider: string; model: string; version: string; healthStatus: string }>> = {};
  for (const model of models) {
    const capabilities = Array.isArray(model.capabilities) ? (model.capabilities as string[]) : [];
    for (const capability of capabilities) {
      (byCapability[capability] ??= []).push({ provider: model.provider, model: model.model, version: model.version, healthStatus: model.healthStatus });
    }
  }
  return { strategy: "capability-match, health-filtered, first-registered wins", byCapability };
}

export async function adminAIPromptPackages() {
  return prisma.promptPackage.findMany({
    orderBy: [{ scope: "asc" }, { key: "asc" }],
    include: { _count: { select: { templates: true, categories: true } } },
  });
}

export async function adminAIPromptVersions(templateId: string) {
  const template = await prisma.promptTemplate.findUnique({
    where: { id: templateId },
    include: { versions: { orderBy: { version: "desc" }, include: { approvals: true, variables: true } }, package: true },
  });
  if (!template) throw ApiError.notFound("Prompt template not found");
  return template;
}

export async function adminAIEvaluations(limit = 100) {
  return prisma.aIEvaluationRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { suite: { select: { key: true, name: true, category: true, businessId: true } } },
  });
}

export async function adminAIEvaluationRun(id: string) {
  const run = await prisma.aIEvaluationRun.findUnique({ where: { id }, include: { results: true, suite: true } });
  if (!run) throw ApiError.notFound("Evaluation run not found");
  return run;
}

export async function adminAIInvocations(query: { page?: number; pageSize?: number; businessId?: string; provider?: string; outcome?: string }) {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50));
  const where: Prisma.AIInvocationLedgerWhereInput = {
    ...(query.businessId ? { businessId: query.businessId } : {}),
    ...(query.provider ? { provider: query.provider } : {}),
    ...(query.outcome ? { outcome: query.outcome } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.aIInvocationLedger.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.aIInvocationLedger.count({ where }),
  ]);
  return { items, total, page, pageSize };
}

export async function adminAIAnalytics() {
  const [runs, ledger, byProvider, outcomes, topBusinesses] = await Promise.all([
    prisma.aIConversationRun.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.aIInvocationLedger.aggregate({ _sum: { cost: true, inputTokens: true, outputTokens: true }, _count: { _all: true } }),
    prisma.aIInvocationLedger.groupBy({ by: ["provider"], _sum: { cost: true }, _count: { _all: true } }),
    prisma.aIAttributedOutcome.groupBy({ by: ["outcomeType"], where: { verified: true }, _count: { _all: true }, _sum: { amount: true } }),
    prisma.aIInvocationLedger.groupBy({ by: ["businessId"], _sum: { cost: true }, _count: { _all: true }, orderBy: { _sum: { cost: "desc" } }, take: 10 }),
  ]);
  return {
    conversations: Object.fromEntries(runs.map((row) => [row.status, row._count._all])),
    invocations: ledger._count._all,
    cost: Number(Number(ledger._sum.cost ?? 0).toFixed(4)),
    tokens: { input: ledger._sum.inputTokens ?? 0, output: ledger._sum.outputTokens ?? 0 },
    byProvider: byProvider.map((row) => ({ provider: row.provider, cost: Number(Number(row._sum.cost ?? 0).toFixed(4)), calls: row._count._all })),
    verifiedOutcomes: outcomes.map((row) => ({ type: row.outcomeType, count: row._count._all, amount: Number(row._sum.amount ?? 0) })),
    topBusinessesByCost: topBusinesses.map((row) => ({ businessId: row.businessId, cost: Number(Number(row._sum.cost ?? 0).toFixed(4)), calls: row._count._all })),
  };
}

export async function adminAIHealth() {
  const [monitoring, foundation] = await Promise.all([getAIMonitoring({}, 24), getAutomationFoundationStatus()]);
  return {
    aiRequests: monitoring.aiRequests,
    aiFailureRate: monitoring.aiFailureRate,
    providerHealth: monitoring.providerHealth,
    circuitBreakerEvents: monitoring.circuitBreakerEvents,
    killSwitches: foundation.killSwitches,
    maintenance: foundation.maintenance,
  };
}

export async function adminAICostDashboard(sinceHours = 720) {
  const [byModel, byBusiness, trend] = await Promise.all([
    prisma.aIInvocationLedger.groupBy({ by: ["provider", "model"], _sum: { cost: true, inputTokens: true, outputTokens: true }, _count: { _all: true } }),
    prisma.aIInvocationLedger.groupBy({ by: ["businessId"], _sum: { cost: true }, orderBy: { _sum: { cost: "desc" } }, take: 25 }),
    getAITrend({ businessId: null, metric: "cost", sinceHours, bucket: "day" }),
  ]);
  return {
    byModel: byModel.map((row) => ({ provider: row.provider, model: row.model, cost: Number(Number(row._sum.cost ?? 0).toFixed(4)), calls: row._count._all, tokensIn: row._sum.inputTokens ?? 0, tokensOut: row._sum.outputTokens ?? 0 })),
    byBusiness: byBusiness.map((row) => ({ businessId: row.businessId, cost: Number(Number(row._sum.cost ?? 0).toFixed(4)) })),
    trend,
  };
}

export async function adminAIMemoryMonitoring() {
  const [logs, records] = await Promise.all([
    prisma.aIRetrievalLog.aggregate({ _avg: { latencyMs: true, compressionRatio: true, contextTokens: true, freshnessScore: true, attributionCoverage: true }, _count: { _all: true } }),
    prisma.aIMemoryRecord.groupBy({ by: ["scope"], where: { supersededById: null }, _count: { _all: true } }),
  ]);
  return {
    retrievals: logs._count._all,
    avgLatencyMs: logs._avg.latencyMs ? Number(logs._avg.latencyMs.toFixed(2)) : 0,
    avgCompressionRatio: logs._avg.compressionRatio ? Number(logs._avg.compressionRatio.toFixed(4)) : 0,
    avgContextTokens: logs._avg.contextTokens ? Math.round(logs._avg.contextTokens) : 0,
    avgFreshness: logs._avg.freshnessScore ? Number(logs._avg.freshnessScore.toFixed(4)) : 0,
    avgAttributionCoverage: logs._avg.attributionCoverage ? Number(logs._avg.attributionCoverage.toFixed(4)) : 0,
    recordsByScope: Object.fromEntries(records.map((row) => [row.scope, row._count._all])),
  };
}

export async function adminAIPolicyMonitoring() {
  const [decisions, active, drafts] = await Promise.all([
    prisma.aIPolicyDecision.groupBy({ by: ["checkpoint", "outcome"], _count: { _all: true } }),
    prisma.aIPolicy.count({ where: { status: "ACTIVE" } }),
    prisma.aIPolicy.count({ where: { status: "DRAFT" } }),
  ]);
  const total = decisions.reduce((sum, row) => sum + row._count._all, 0);
  const byOutcome: Record<string, number> = {};
  for (const row of decisions) byOutcome[row.outcome] = (byOutcome[row.outcome] ?? 0) + row._count._all;
  return {
    totalDecisions: total,
    byOutcome,
    byCheckpoint: decisions.map((row) => ({ checkpoint: row.checkpoint, outcome: row.outcome, count: row._count._all })),
    activePolicies: active,
    draftPolicies: drafts,
    denialRate: total ? Number(((byOutcome.DENY ?? 0) / total).toFixed(4)) : 0,
  };
}
