import { prisma } from "../../lib/prisma.js";

/** Aggregate retrieval telemetry for the monitoring endpoint. */
export async function retrievalMonitoring(businessId: string, sinceHours: number) {
  const since = new Date(Date.now() - sinceHours * 3_600_000);
  const logs = await prisma.aIRetrievalLog.findMany({
    where: { businessId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 2000,
  });
  const total = logs.length;
  const avg = (pick: (row: (typeof logs)[number]) => number) => (total ? Number((logs.reduce((sum, row) => sum + pick(row), 0) / total).toFixed(4)) : 0);
  const hits = logs.filter((row) => row.hit).length;

  const byPhase: Record<string, { count: number; hitRate: number; avgLatencyMs: number; avgContextTokens: number }> = {};
  for (const phase of new Set(logs.map((row) => row.phase))) {
    const rows = logs.filter((row) => row.phase === phase);
    byPhase[phase] = {
      count: rows.length,
      hitRate: Number((rows.filter((row) => row.hit).length / rows.length).toFixed(4)),
      avgLatencyMs: Number((rows.reduce((sum, row) => sum + row.latencyMs, 0) / rows.length).toFixed(1)),
      avgContextTokens: Number((rows.reduce((sum, row) => sum + row.contextTokens, 0) / rows.length).toFixed(0)),
    };
  }

  const now = new Date();
  const [recordCount, expiredCount, sessionCount, scopeGroups] = await Promise.all([
    prisma.aIMemoryRecord.count({ where: { businessId, supersededById: null } }),
    prisma.aIMemoryRecord.count({ where: { businessId, expiresAt: { not: null, lt: now } } }),
    prisma.aIMemorySession.count({ where: { businessId } }),
    prisma.aIMemoryRecord.groupBy({ by: ["scope"], where: { businessId, supersededById: null }, _count: { _all: true } }),
  ]);

  return {
    windowHours: sinceHours,
    retrievals: total,
    memoryHits: hits,
    memoryMisses: total - hits,
    hitRate: total ? Number((hits / total).toFixed(4)) : 0,
    avgRetrievalLatencyMs: avg((row) => row.latencyMs),
    avgCompressionRatio: avg((row) => row.compressionRatio),
    avgContextTokens: avg((row) => row.contextTokens),
    avgRawTokens: avg((row) => row.rawTokens),
    avgMemoryFreshness: avg((row) => row.freshnessScore),
    avgSourceAttributionCoverage: avg((row) => row.attributionCoverage),
    avgDuplicatesSuppressed: avg((row) => row.duplicatesSuppressed),
    byPhase,
    store: {
      activeRecords: recordCount,
      expiredRecordsPendingPrune: expiredCount,
      activeSessions: sessionCount,
      byScope: Object.fromEntries(scopeGroups.map((group) => [group.scope, group._count._all])),
    },
  };
}
