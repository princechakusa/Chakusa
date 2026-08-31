import { prisma } from "../../prisma.js";
import { circuitBreakerSnapshot } from "./circuitBreaker.js";

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
}

/**
 * Live operational snapshot straight from the ledgers — AI requests /
 * failures, provider failures, routing decisions, tokens, cost, latency,
 * memory-retrieval latency, prompt & tool usage, approval / escalation /
 * denial rates, circuit-breaker events and provider health.
 */
export async function getAIMonitoring(scope: { businessId?: string | null }, sinceHours = 168) {
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const where = scope.businessId ? { businessId: scope.businessId, createdAt: { gte: since } } : { createdAt: { gte: since } };

  const [ledger, decisions, retrieval, healthChecks] = await Promise.all([
    prisma.aIInvocationLedger.findMany({
      where,
      select: { provider: true, model: true, promptVersion: true, outcome: true, inputTokens: true, outputTokens: true, reasoningTokens: true, cost: true, latencyMs: true, safetyResult: true, approvalStatus: true, createdAt: true },
    }),
    prisma.aIPolicyDecision.groupBy({ by: ["checkpoint", "outcome"], where, _count: { _all: true } }),
    prisma.aIRetrievalLog.aggregate({ where, _avg: { latencyMs: true, compressionRatio: true, contextTokens: true, freshnessScore: true, attributionCoverage: true }, _count: { _all: true } }),
    prisma.aIProviderHealthCheck.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" } }),
  ]);

  const modelCalls = ledger.filter((row) => row.provider !== "tool-broker");
  const toolCalls = ledger.filter((row) => row.provider === "tool-broker");
  const failures = modelCalls.filter((row) => row.outcome === "FAILED");
  const latencies = modelCalls.map((row) => row.latencyMs ?? 0).filter((value) => value > 0);

  const byProvider: Record<string, { requests: number; failures: number; cost: number; tokensIn: number; tokensOut: number }> = {};
  for (const row of modelCalls) {
    const bucket = (byProvider[row.provider] ??= { requests: 0, failures: 0, cost: 0, tokensIn: 0, tokensOut: 0 });
    bucket.requests += 1;
    if (row.outcome === "FAILED") bucket.failures += 1;
    bucket.cost += Number(row.cost ?? 0);
    bucket.tokensIn += row.inputTokens ?? 0;
    bucket.tokensOut += row.outputTokens ?? 0;
  }

  const routing: Record<string, number> = {};
  for (const row of modelCalls) routing[`${row.provider}/${row.model}`] = (routing[`${row.provider}/${row.model}`] ?? 0) + 1;

  const promptUsage: Record<string, number> = {};
  for (const row of modelCalls) if (row.promptVersion) promptUsage[row.promptVersion] = (promptUsage[row.promptVersion] ?? 0) + 1;

  const toolUsage: Record<string, number> = {};
  for (const row of toolCalls) toolUsage[row.model] = (toolUsage[row.model] ?? 0) + 1;

  const decisionTotals = { total: 0, approvals: 0, escalations: 0, denials: 0 };
  for (const row of decisions) {
    decisionTotals.total += row._count._all;
    if (row.outcome === "REQUIRE_APPROVAL") decisionTotals.approvals += row._count._all;
    if (row.outcome === "ESCALATE") decisionTotals.escalations += row._count._all;
    if (row.outcome === "DENY") decisionTotals.denials += row._count._all;
  }

  const latestHealthByProvider = new Map<string, (typeof healthChecks)[number]>();
  for (const check of healthChecks) {
    const key = `${check.provider}/${check.model ?? "*"}`;
    if (!latestHealthByProvider.has(key)) latestHealthByProvider.set(key, check);
  }

  return {
    windowHours: sinceHours,
    aiRequests: modelCalls.length,
    aiFailures: failures.length,
    aiFailureRate: modelCalls.length ? Number((failures.length / modelCalls.length).toFixed(4)) : 0,
    providerFailures: Object.fromEntries(Object.entries(byProvider).map(([provider, value]) => [provider, value.failures])),
    routingDecisions: routing,
    tokens: {
      input: modelCalls.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
      output: modelCalls.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
      reasoning: modelCalls.reduce((sum, row) => sum + (row.reasoningTokens ?? 0), 0),
    },
    cost: Number(modelCalls.reduce((sum, row) => sum + Number(row.cost ?? 0), 0).toFixed(4)),
    latencyMs: { avg: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0, p95: percentile(latencies, 0.95) },
    memoryRetrieval: {
      retrievals: retrieval._count._all,
      avgLatencyMs: retrieval._avg.latencyMs ? Number(retrieval._avg.latencyMs.toFixed(2)) : 0,
      avgCompressionRatio: retrieval._avg.compressionRatio ? Number(retrieval._avg.compressionRatio.toFixed(4)) : 0,
      avgContextTokens: retrieval._avg.contextTokens ? Math.round(retrieval._avg.contextTokens) : 0,
      avgAttributionCoverage: retrieval._avg.attributionCoverage ? Number(retrieval._avg.attributionCoverage.toFixed(4)) : 0,
    },
    promptUsage,
    toolUsage: { total: toolCalls.length, byTool: toolUsage },
    policy: {
      decisions: decisionTotals.total,
      approvalRate: decisionTotals.total ? Number((decisionTotals.approvals / decisionTotals.total).toFixed(4)) : 0,
      escalationRate: decisionTotals.total ? Number((decisionTotals.escalations / decisionTotals.total).toFixed(4)) : 0,
      denials: decisionTotals.denials,
    },
    circuitBreakerEvents: healthChecks.length,
    providerHealth: {
      live: circuitBreakerSnapshot(),
      persisted: [...latestHealthByProvider.values()].map((check) => ({
        provider: check.provider,
        model: check.model,
        status: check.status,
        circuitState: check.circuitState,
        successRate: check.successRate,
        p95LatencyMs: check.p95LatencyMs,
        consecutiveFailures: check.consecutiveFailures,
        openedAt: check.openedAt,
        at: check.createdAt,
      })),
    },
    byProvider: Object.fromEntries(Object.entries(byProvider).map(([k, v]) => [k, { ...v, cost: Number(v.cost.toFixed(4)) }])),
  };
}
