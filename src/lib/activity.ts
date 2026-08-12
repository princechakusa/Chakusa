import type { Prisma, ActivityEventType } from "@prisma/client";
import { prisma } from "./prisma.js";

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

interface RecordActivityInput {
  businessId: string;
  actorId?: string | null;
  eventType: ActivityEventType;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * db defaults to the global client, but callers that need the activity
 * write to be part of a larger atomic transaction (e.g. a status
 * transition + its activity event) should pass their transaction client.
 */
export async function recordActivity(input: RecordActivityInput, db: DatabaseClient = prisma) {
  return db.activityEvent.create({
    data: {
      businessId: input.businessId,
      actorId: input.actorId ?? null,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
    },
  });
}
