import { prisma } from "../../lib/prisma.js";

export async function getOutboxStatus() {
  const [counts, oldest, recent, deliveries, runtime, executionEvents] = await Promise.all([
    prisma.outboxEvent.groupBy({ by: ["status"], _count: { _all: true }, _sum: { retryCount: true } }),
    prisma.outboxEvent.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.outboxEvent.findMany({ orderBy: { createdAt: "desc" }, take: 20, select: { id: true, eventType: true, aggregateType: true, businessId: true, status: true, retryCount: true, createdAt: true, publishedAt: true } }),
    prisma.eventDelivery.groupBy({ by: ["status"], _count: { _all: true }, _sum: { attempts: true } }),
    prisma.workflowExecution.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.workflowExecutionEvent.aggregate({ where: { createdAt: { gte: new Date(Date.now() - 86_400_000) } }, _avg: { durationMs: true }, _count: { _all: true }, _sum: { retryCount: true } }),
  ]);
  return { counts: counts.map((row) => ({ status: row.status, count: row._count._all, retries: row._sum.retryCount ?? 0 })), deliveries: deliveries.map((row) => ({ status: row.status, count: row._count._all, attempts: row._sum.attempts ?? 0 })), runtime: runtime.map((row) => ({ status: row.status, count: row._count._all })), last24Hours: { events: executionEvents._count._all, averageDurationMs: executionEvents._avg.durationMs, retries: executionEvents._sum.retryCount ?? 0 }, oldestPendingAt: oldest?.createdAt ?? null, recent };
}
