import { prisma } from "../prisma.js";
import { readWorkerHeartbeat, workerHeartbeatHealthy } from "../../worker/workerHeartbeat.js";

export async function readAutomationHealth() {
  const now = new Date();
  const [pendingOutbox, retryDeliveries, deadDeliveries, runnable, failed, overdueSchedules, oldest, oldestRuntime, heartbeat, staleOutboxLeases, staleDeliveryLeases, staleRuntimeLeases, blockedWorkflows, lastCompleted, lastFailed] = await Promise.all([
    prisma.outboxEvent.count({ where: { status: { in: ["PENDING", "FAILED"] } } }),
    prisma.eventDelivery.count({ where: { status: "RETRY" } }),
    prisma.eventDelivery.count({ where: { status: "DEAD" } }),
    prisma.workflowExecution.count({ where: { status: { in: ["PENDING", "RUNNING"] }, completedAt: null } }),
    prisma.workflowExecution.count({ where: { status: "FAILED", completedAt: null } }),
    prisma.workflow.count({ where: { status: "PUBLISHED", scheduleEnabled: true, nextTriggerAt: { lt: new Date(now.getTime() - 300_000) } } }),
    prisma.outboxEvent.findFirst({ where: { status: { in: ["PENDING", "FAILED"] } }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.workflowExecution.findFirst({ where: { status: { in: ["PENDING", "FAILED"] }, completedAt: null }, orderBy: { nextAttemptAt: "asc" }, select: { nextAttemptAt: true } }),
    readWorkerHeartbeat(),
    prisma.outboxEvent.count({ where: { leaseOwner: { not: null }, leaseExpiresAt: { lt: now } } }),
    prisma.eventDelivery.count({ where: { leaseOwner: { not: null }, leaseExpiresAt: { lt: now } } }),
    prisma.workflowExecution.count({ where: { status: "RUNNING", leaseExpiresAt: { lt: now }, completedAt: null } }),
    prisma.workflowExecution.count({ where: { status: "FAILED", completedAt: null, nextAttemptAt: { lt: new Date(now.getTime() - 300_000) } } }),
    prisma.workflowExecutionEvent.findFirst({ where: { type: "COMPLETED" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.workflowExecutionEvent.findFirst({ where: { type: { in: ["FAILED_FINAL", "RETRY_SCHEDULED", "TIMED_OUT", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, type: true } }),
  ]);
  const oldestEventAgeMs = oldest ? now.getTime() - oldest.createdAt.getTime() : 0;
  const oldestRuntimeLagMs = oldestRuntime ? Math.max(0, now.getTime() - oldestRuntime.nextAttemptAt.getTime()) : 0;
  const workerAvailable = workerHeartbeatHealthy(heartbeat?.lastSuccessAt ?? null, now);
  return {
    status: !workerAvailable || deadDeliveries > 0 || oldestEventAgeMs > 300_000 || oldestRuntimeLagMs > 300_000 || overdueSchedules > 0 || staleOutboxLeases + staleDeliveryLeases + staleRuntimeLeases > 0 || blockedWorkflows > 0 ? "degraded" : "ok",
    worker: { available: workerAvailable, lastSuccessAt: heartbeat?.lastSuccessAt ?? null },
    queues: { outbox: pendingOutbox, deliveryRetries: retryDeliveries, deadLetters: deadDeliveries, workflowRunnable: runnable, workflowFailures: failed, overdueSchedules },
    oldestEventAgeMs,
    oldestRuntimeLagMs,
    leases: { staleOutbox: staleOutboxLeases, staleDeliveries: staleDeliveryLeases, staleRuntime: staleRuntimeLeases },
    blockedWorkflows,
    processing: { lastSuccessfulAt: lastCompleted?.createdAt ?? null, lastFailureAt: lastFailed?.createdAt ?? null, lastFailureType: lastFailed?.type ?? null },
  };
}
