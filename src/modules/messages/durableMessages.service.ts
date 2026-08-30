import { randomUUID } from "node:crypto";
import type { Plan, SubscriptionStatus } from "@prisma/client";
import { enqueueMessage } from "../../lib/messaging/messagingPlatform.js";
import type { SendMessageInput } from "./messages.schemas.js";

export function sendDurableMessage(businessId: string, input: SendMessageInput, plan: Plan, status: SubscriptionStatus) {
  return enqueueMessage({ businessId, customerId: input.customerId, leadId: input.leadId, body: input.body, messageType: input.messageType ?? "custom", channel: input.channel ?? "sms", purpose: input.purpose ?? "SERVICE", actorType: "HUMAN", idempotencyKey: input.idempotencyKey ?? randomUUID() }, plan, status);
}
