import type { Prisma } from "@prisma/client";

export type OutboxTransaction = Prisma.TransactionClient;
export interface OutboxEventInput {
  dedupeKey: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  tenantId: string;
  businessId: string;
  payload: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  eventVersion?: number;
  correlationId?: string;
  causationId?: string;
}

/** Persist only. The caller must invoke this with its existing transaction. */
export async function recordOutboxEvent(tx: OutboxTransaction, input: OutboxEventInput) {
  return tx.outboxEvent.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: { ...input, eventVersion: input.eventVersion ?? 1 },
    update: {},
  });
}
