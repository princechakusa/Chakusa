import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
const LEASE_MS = 60_000; const MAX_ATTEMPTS = 10;

export async function publishOutboxBatch(batchSize = 50) {
  const owner = randomUUID(); const now = new Date(); const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const claimed = await prisma.$transaction(async (tx) => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH candidates AS (SELECT o.id FROM outbox_events o WHERE o.status IN ('PENDING','FAILED') AND o.retry_count < ${MAX_ATTEMPTS} AND o.next_attempt_at <= ${now} AND (o.lease_expires_at IS NULL OR o.lease_expires_at < ${now}) AND NOT EXISTS (SELECT 1 FROM outbox_events earlier WHERE earlier.business_id=o.business_id AND earlier.aggregate_type=o.aggregate_type AND earlier.aggregate_id=o.aggregate_id AND (earlier.created_at,earlier.id)<(o.created_at,o.id) AND earlier.status NOT IN ('PUBLISHED','DEAD')) ORDER BY o.created_at,o.id FOR UPDATE SKIP LOCKED LIMIT ${batchSize})
    UPDATE outbox_events o SET status='PROCESSING',lease_owner=${owner},lease_expires_at=${leaseUntil},last_attempt_at=${now},retry_count=o.retry_count+1 FROM candidates c WHERE o.id=c.id RETURNING o.id
  `));
  let published = 0;
  for (const row of claimed) try {
    await prisma.$transaction(async (tx) => { const event = await tx.outboxEvent.findFirstOrThrow({ where: { id: row.id, leaseOwner: owner, status: "PROCESSING" } }); const subscriptions = await tx.eventSubscription.findMany({ where: { active: true, eventType: event.eventType } }); for (const subscription of subscriptions) await tx.eventDelivery.upsert({ where: { eventId_subscriptionId: { eventId: event.id, subscriptionId: subscription.id } }, create: { eventId: event.id, subscriptionId: subscription.id }, update: {} }); await tx.outboxEvent.update({ where: { id: event.id }, data: { status: "PUBLISHED", publishedAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: null } }); }); published += 1;
  } catch (error) { const event = await prisma.outboxEvent.findUnique({ where: { id: row.id }, select: { retryCount: true } }); const dead = (event?.retryCount ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS; const backoff = Math.min(3_600_000, 5_000 * 2 ** Math.max(0, (event?.retryCount ?? 1) - 1)); await prisma.outboxEvent.updateMany({ where: { id: row.id, leaseOwner: owner, status: "PROCESSING" }, data: { status: dead ? "DEAD" : "FAILED", nextAttemptAt: new Date(Date.now() + backoff), leaseOwner: null, leaseExpiresAt: null, lastError: error instanceof Error ? error.message.slice(0, 2_000) : "publication_failed" } }); }
  return { claimed: claimed.length, published };
}
export function recoverExpiredOutboxClaims(now = new Date()) { return prisma.$transaction(async (tx) => { const terminal = await tx.outboxEvent.updateMany({ where: { status: "PROCESSING", leaseExpiresAt: { lt: now }, retryCount: { gte: MAX_ATTEMPTS } }, data: { status: "DEAD", leaseOwner: null, leaseExpiresAt: null, lastError: "publisher_lease_expired_final" } }); const retryable = await tx.outboxEvent.updateMany({ where: { status: "PROCESSING", leaseExpiresAt: { lt: now }, retryCount: { lt: MAX_ATTEMPTS } }, data: { status: "FAILED", leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: now, lastError: "publisher_lease_expired" } }); return { count: terminal.count + retryable.count }; }); }
