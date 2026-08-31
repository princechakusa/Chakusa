import type { MessageType } from "@prisma/client";
import type { IdempotentActionGateway } from "../automation/defaultActions.js";
import { PermanentActionError } from "../automation/actionRegistry.js";
import { prisma } from "../prisma.js";
import { enqueueMessage } from "./messagingPlatform.js";

export class WorkflowMessagingGateway implements IdempotentActionGateway {
  async execute({ context, config, idempotencyKey, signal }: Parameters<IdempotentActionGateway["execute"]>[0]) {
    signal.throwIfAborted();
    const input = context.input && typeof context.input === "object" ? context.input as Record<string, unknown> : {};
    const customer = input.customer && typeof input.customer === "object" ? input.customer as Record<string, unknown> : {};
    const customerId = String(config.customerId ?? customer.id ?? "");
    if (!customerId) throw new PermanentActionError("messaging_customer_required");
    if (config.templateVersionId) {
      const template = await prisma.messagingTemplateVersion.findFirst({ where: { id: String(config.templateVersionId), status: "PUBLISHED", template: { OR: [{ businessId: context.businessId }, { businessId: null }], deletedAt: null } } });
      if (!template) throw new PermanentActionError("messaging_template_not_published");
    }
    const subscription = await prisma.subscription.findUnique({ where: { businessId: context.businessId }, select: { plan: true, status: true } });
    if (!subscription) throw new PermanentActionError("messaging_subscription_required");
    return enqueueMessage({ businessId: context.businessId, customerId, body: String(config.body), messageType: String(config.messageType ?? "custom") as MessageType, channel: config.channel === "whatsapp" ? "whatsapp" : "sms", purpose: config.purpose === "MARKETING" ? "MARKETING" : config.purpose === "TRANSACTIONAL" ? "TRANSACTIONAL" : "SERVICE", actorType: "AUTOMATION", idempotencyKey, correlationId: context.executionId, causationId: context.nodeId }, subscription.plan, subscription.status);
  }
}
