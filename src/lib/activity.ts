import type { Prisma, ActivityEventType } from "@prisma/client";
import { prisma } from "./prisma.js";

interface RecordActivityInput {
  businessId: string;
  actorId?: string | null;
  eventType: ActivityEventType;
  entityType: string;
  entityId: string;
  metadata?: Prisma.InputJsonValue;
}

export async function recordActivity(input: RecordActivityInput) {
  return prisma.activityEvent.create({
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
