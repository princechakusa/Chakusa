import { prisma } from '../lib/prisma.js';

export const WORKER_HEARTBEAT_ID = 'automation-worker';
export const WORKER_HEARTBEAT_STALE_MS = 90_000;

export function workerHeartbeatHealthy(lastSuccessAt: Date | null, now = new Date()) {
  return Boolean(lastSuccessAt && now.getTime() - lastSuccessAt.getTime() <= WORKER_HEARTBEAT_STALE_MS);
}

export async function recordWorkerHeartbeat(startedAt: Date) {
  const lastSuccessAt = new Date();
  await prisma.workerHeartbeat.upsert({
    where: { id: WORKER_HEARTBEAT_ID },
    create: { id: WORKER_HEARTBEAT_ID, startedAt, lastSuccessAt },
    update: { startedAt, lastSuccessAt },
  });
}

export async function readWorkerHeartbeat() {
  return prisma.workerHeartbeat.findUnique({ where: { id: WORKER_HEARTBEAT_ID } });
}
