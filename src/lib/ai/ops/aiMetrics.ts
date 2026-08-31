import type { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";

// LOOP 3B-4: operational metric buckets. recordAIEvent() upserts an hourly
// bucket so trend reporting is a cheap indexed range scan instead of a
// full ledger aggregation. Live snapshots still read the raw ledgers.

export const AI_METRICS = [
  "ai_requests",
  "ai_failures",
  "provider_failures",
  "routing_decisions",
  "tokens_input",
  "tokens_output",
  "cost",
  "latency_ms",
  "memory_retrieval_latency_ms",
  "prompt_usage",
  "tool_usage",
  "approvals",
  "escalations",
  "policy_denials",
  "circuit_breaker_events",
] as const;
export type AIMetric = (typeof AI_METRICS)[number];

function hourWindow(at: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours()));
  return { start, end: new Date(start.getTime() + 3_600_000) };
}

/** Records one operational event into its hourly bucket. Never throws on the hot path. */
export async function recordAIEvent(input: {
  businessId?: string | null;
  metric: AIMetric;
  value?: number;
  provider?: string | null;
  model?: string | null;
  at?: Date;
  dimensions?: Record<string, unknown>;
}) {
  const value = input.value ?? 1;
  const { start, end } = hourWindow(input.at ?? new Date());
  const scope = input.businessId ? "BUSINESS" : "PLATFORM";
  const businessId = input.businessId ?? null;
  const provider = input.provider ?? null;
  const model = input.model ?? null;
  // The bucket's compound-unique contains nullable columns, so a Prisma
  // upsert cannot target it. LOOP 5 hardening: find-then-write, but a
  // concurrent-create P2002 now retries as an increment instead of silently
  // dropping the sample — the bucket stays accurate under load.
  const write = async () => {
    const existing = await prisma.aIOperationalMetric.findFirst({
      where: { businessId, scope, metric: input.metric, provider, model, windowStart: start },
      select: { id: true, min: true, max: true },
    });
    if (existing) {
      await prisma.aIOperationalMetric.update({
        where: { id: existing.id },
        data: { count: { increment: 1 }, sum: { increment: value }, min: Math.min(existing.min ?? value, value), max: Math.max(existing.max ?? value, value) },
      });
      return;
    }
    await prisma.aIOperationalMetric.create({
      data: { businessId, scope, metric: input.metric, provider, model, windowStart: start, windowEnd: end, count: 1, sum: value, min: value, max: value, dimensions: (input.dimensions ?? undefined) as Prisma.InputJsonValue | undefined },
    });
  };
  try {
    await write();
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002") {
      try {
        await write();
        return;
      } catch {
        /* fall through — metrics are best-effort */
      }
    }
    // Metrics are best-effort; a bucket write must never fail an AI call.
  }
}

/** Fire-and-forget helper for the hot path. */
export function emitAIEvent(input: Parameters<typeof recordAIEvent>[0]) {
  void recordAIEvent(input);
}

export interface TrendPoint {
  windowStart: string;
  count: number;
  sum: number;
  avg: number;
  min: number | null;
  max: number | null;
}

/** Historical trend series for one metric, bucketed by hour or day. */
export async function getAITrend(input: {
  businessId?: string | null;
  metric: AIMetric;
  sinceHours: number;
  bucket?: "hour" | "day";
  provider?: string | null;
}): Promise<TrendPoint[]> {
  const since = new Date(Date.now() - input.sinceHours * 3_600_000);
  const rows = await prisma.aIOperationalMetric.findMany({
    where: {
      businessId: input.businessId ?? null,
      scope: input.businessId ? "BUSINESS" : "PLATFORM",
      metric: input.metric,
      ...(input.provider ? { provider: input.provider } : {}),
      windowStart: { gte: since },
    },
    orderBy: { windowStart: "asc" },
  });
  const bucketMs = input.bucket === "day" ? 86_400_000 : 3_600_000;
  const buckets = new Map<number, TrendPoint>();
  for (const row of rows) {
    const key = Math.floor(row.windowStart.getTime() / bucketMs) * bucketMs;
    const point = buckets.get(key) ?? { windowStart: new Date(key).toISOString(), count: 0, sum: 0, avg: 0, min: null, max: null };
    point.count += row.count;
    point.sum += row.sum;
    point.min = point.min == null ? row.min : Math.min(point.min, row.min ?? point.min);
    point.max = point.max == null ? row.max : Math.max(point.max, row.max ?? point.max);
    buckets.set(key, point);
  }
  return [...buckets.values()].map((point) => ({ ...point, sum: Number(point.sum.toFixed(4)), avg: point.count ? Number((point.sum / point.count).toFixed(4)) : 0 }));
}
