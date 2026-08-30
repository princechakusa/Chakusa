import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma.js";

export interface DomainEvent { id: string; type: string; version: number; businessId: string; payload: unknown; metadata?: unknown; correlationId?: string; causationId?: string; }
export type DurableEventHandler = (event: DomainEvent) => Promise<void>;
const handlers = new Map<string, DurableEventHandler>();
const LEASE_MS = 60_000;

export async function registerSubscriber(input: { name: string; eventType: string; version?: number; maxAttempts?: number; handler: DurableEventHandler }) {
  handlers.set(input.name, input.handler);
  return prisma.eventSubscription.upsert({ where: { name: input.name }, create: { name: input.name, eventType: input.eventType, version: input.version ?? 1, maxAttempts: input.maxAttempts ?? 8 }, update: { eventType: input.eventType, version: input.version ?? 1, maxAttempts: input.maxAttempts ?? 8, active: true } });
}

export async function dispatchDeliveryBatch(batchSize = 50) {
  const owner = randomUUID(); const now = new Date(); const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const claimed = await prisma.$transaction(async (tx) => tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH candidates AS (SELECT d.id FROM event_deliveries d JOIN outbox_events e ON e.id=d.event_id JOIN event_subscriptions s ON s.id=d.subscription_id WHERE d.status IN ('PENDING','RETRY') AND d.attempts < s.max_attempts AND d.next_attempt_at <= ${now} AND (d.lease_expires_at IS NULL OR d.lease_expires_at < ${now}) AND NOT EXISTS (SELECT 1 FROM event_deliveries earlier_d JOIN outbox_events earlier_e ON earlier_e.id=earlier_d.event_id WHERE earlier_d.subscription_id=d.subscription_id AND earlier_e.business_id=e.business_id AND earlier_e.aggregate_type=e.aggregate_type AND earlier_e.aggregate_id=e.aggregate_id AND (earlier_e.created_at,earlier_e.id)<(e.created_at,e.id) AND earlier_d.status NOT IN ('DELIVERED','DEAD')) ORDER BY e.created_at,e.id,d.created_at,d.id FOR UPDATE OF d SKIP LOCKED LIMIT ${batchSize})
    UPDATE event_deliveries d SET status='PROCESSING',lease_owner=${owner},lease_expires_at=${leaseUntil},attempts=d.attempts+1 FROM candidates c WHERE d.id=c.id RETURNING d.id
  `));
  let delivered = 0;
  for (const row of claimed) {
    const delivery = await prisma.eventDelivery.findUnique({ where: { id: row.id }, include: { event: true, subscription: true } });
    if (!delivery || delivery.leaseOwner !== owner) continue;
    try {
      const handler = handlers.get(delivery.subscription.name); if (!handler) throw new Error(`Subscriber handler is not registered: ${delivery.subscription.name}`);
      await handler({ id: delivery.event.id, type: delivery.event.eventType, version: delivery.event.eventVersion, businessId: delivery.event.businessId, payload: delivery.event.payload, metadata: delivery.event.metadata, correlationId: delivery.event.correlationId ?? undefined, causationId: delivery.event.causationId ?? undefined });
      await prisma.eventDelivery.updateMany({ where: { id: delivery.id, leaseOwner: owner, status: "PROCESSING" }, data: { status: "DELIVERED", deliveredAt: new Date(), leaseOwner: null, leaseExpiresAt: null, lastError: null } }); delivered += 1;
    } catch (error) {
      const dead = delivery.attempts >= delivery.subscription.maxAttempts; const backoff = Math.min(3_600_000, 5_000 * 2 ** Math.max(0, delivery.attempts - 1));
      await prisma.eventDelivery.updateMany({ where: { id: delivery.id, leaseOwner: owner, status: "PROCESSING" }, data: { status: dead ? "DEAD" : "RETRY", nextAttemptAt: new Date(Date.now() + backoff), leaseOwner: null, leaseExpiresAt: null, lastError: error instanceof Error ? error.message.slice(0, 2_000) : "subscriber_failed" } });
    }
  }
  return { claimed: claimed.length, delivered };
}

export function recoverExpiredDeliveries(now = new Date()) { return prisma.$transaction(async (tx) => { const terminal = await tx.$executeRaw(Prisma.sql`UPDATE event_deliveries d SET status='DEAD',lease_owner=NULL,lease_expires_at=NULL,last_error='delivery_lease_expired_final' FROM event_subscriptions s WHERE d.subscription_id=s.id AND d.status='PROCESSING' AND d.lease_expires_at < ${now} AND d.attempts >= s.max_attempts`); const retryable = await tx.eventDelivery.updateMany({ where: { status: "PROCESSING", leaseExpiresAt: { lt: now } }, data: { status: "RETRY", leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: now, lastError: "delivery_lease_expired" } }); return { count: terminal + retryable.count }; }); }
export function clearSubscriberHandlers() { handlers.clear(); }
