import { createHash, randomUUID } from "node:crypto";
import type { MessageType, Plan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { parsePhoneNumber } from "../phone.js";
import { assertFeatureAvailable } from "../entitlements.js";
import { messagingBudgetAvailable } from "./messagingBudget.js";
import { sendOutboundMessage } from "./messagingService.js";
import type { MessagingProvider } from "./messagingProvider.js";
import { getMessagingProvider } from "./providerRegistry.js";

export type PlatformChannel = "sms" | "whatsapp";
export type MessagePurpose = "SERVICE" | "TRANSACTIONAL" | "MARKETING";

export interface MessagingRequest {
  businessId: string;
  customerId: string;
  leadId?: string;
  body: string;
  messageType: MessageType;
  channel?: PlatformChannel;
  purpose?: MessagePurpose;
  actorType?: "HUMAN" | "AUTOMATION" | "SYSTEM";
  actorId?: string;
  idempotencyKey: string;
  correlationId?: string;
  causationId?: string;
  scheduledAt?: Date;
  expiresAt?: Date;
}

const STOP_WORDS = new Set(["stop", "unsubscribe", "cancel", "end", "quit"]);
const START_WORDS = new Set(["start", "unstop", "subscribe"]);

function payloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function enqueueMessage(request: MessagingRequest, plan: Plan, status: SubscriptionStatus) {
  assertFeatureAvailable(plan, status, "OUTBOUND_MESSAGING");
  if (!(await messagingBudgetAvailable(request.businessId)).available) throw ApiError.forbidden("The monthly messaging safety limit has been reached");
  const customer = await prisma.customer.findFirst({ where: { id: request.customerId, businessId: request.businessId } });
  if (!customer) throw ApiError.notFound("Customer not found");
  const destination = customer.phoneE164;
  if (!destination) throw ApiError.badRequest("Customer does not have a valid E.164 phone number on file", { reason: "MISSING_PHONE_E164" });
  const channel = request.channel ?? "sms";
  const countryCode = parsePhoneNumber(destination).country ?? "ZZ";
  const purpose = request.purpose ?? "SERVICE";
  const blocked = await prisma.suppression.findFirst({
    where: { businessId: request.businessId, active: true, OR: [{ customerId: customer.id }, { address: destination }], channel: { in: [channel.toUpperCase(), "ALL"] } },
  });
  const legacyBlocked = await prisma.customerOptOut.findFirst({ where: { businessId: request.businessId, phone: destination, channel: { in: [channel === "sms" ? "SMS" : "WHATSAPP", "ALL"] } } });
  if (blocked || legacyBlocked) throw ApiError.forbidden("This customer has opted out of this messaging channel");
  if (purpose === "MARKETING") {
    const preference = await prisma.customerCommunicationPreference.findUnique({ where: { businessId_customerId: { businessId: request.businessId, customerId: customer.id } } });
    if (preference && !preference.marketingConsent) throw ApiError.forbidden("Marketing consent is not active for this customer");
  }
  const route = await prisma.messagingChannelAccount.findFirst({ where: { businessId: request.businessId, channel, status: "ACTIVE", deletedAt: null }, include: { senders: { where: { status: "ACTIVE", deletedAt: null, OR: [{ countryCode }, { countryCode: null }] }, orderBy: { createdAt: "asc" }, take: 1 } }, orderBy: { createdAt: "asc" } });
  const providerId = route?.provider ?? "twilio";

  return prisma.$transaction(async (tx) => {
    const existing = await tx.message.findUnique({ where: { idempotencyKey: request.idempotencyKey }, include: { dispatches: true } });
    if (existing) {
      if (existing.businessId !== request.businessId || existing.customerId !== request.customerId || existing.body !== request.body) {
        throw ApiError.conflict("Idempotency key was already used for a different message");
      }
      return existing;
    }
    let conversation = await tx.conversation.findFirst({ where: { businessId: request.businessId, customerId: customer.id, status: { in: ["OPEN", "PENDING"] }, deletedAt: null }, orderBy: { updatedAt: "desc" } });
    if (!conversation) {
      conversation = await tx.conversation.create({ data: { businessId: request.businessId, customerId: customer.id, status: "OPEN", automationMode: request.actorType === "AUTOMATION" ? "AUTOMATED" : "HUMAN", participants: { create: { businessId: request.businessId, customerId: customer.id, externalAddress: destination, role: "CUSTOMER" } }, lifecycleEvents: { create: { businessId: request.businessId, type: "OPENED", actorId: request.actorId } } } });
    }
    const message = await tx.message.create({
      data: { businessId: request.businessId, customerId: customer.id, leadId: request.leadId, conversationId: conversation.id, messageType: request.messageType, channel, body: request.body, status: "draft", direction: "OUTBOUND", actorType: request.actorType ?? "HUMAN", idempotencyKey: request.idempotencyKey, correlationId: request.correlationId, causationId: request.causationId, purpose, scheduledAt: request.scheduledAt ?? new Date(), expiresAt: request.expiresAt, contents: { create: { businessId: request.businessId, contentType: "TEXT", body: request.body } }, dispatches: { create: { businessId: request.businessId, channel, provider: providerId, senderId: route?.senders[0]?.id, destination, status: "PENDING", nextAttemptAt: request.scheduledAt ?? new Date(), idempotencyKey: request.idempotencyKey } } },
      include: { dispatches: true },
    });
    await tx.conversation.update({ where: { id: conversation.id }, data: { lastOutboundAt: new Date() } });
    return message;
  });
}

export async function processMessageDispatches(provider?: MessagingProvider, limit = 20, owner = randomUUID()) {
  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM message_dispatches
      WHERE status IN ('PENDING','RETRY') AND next_attempt_at <= NOW()
        AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
      ORDER BY next_attempt_at ASC FOR UPDATE SKIP LOCKED LIMIT ${limit}`;
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    await tx.messageDispatch.updateMany({ where: { id: { in: ids } }, data: { status: "PROCESSING", leaseOwner: owner, leaseExpiresAt: new Date(Date.now() + 60_000) } });
    return tx.messageDispatch.findMany({ where: { id: { in: ids }, leaseOwner: owner }, include: { message: true } });
  });
  for (const dispatch of claimed) {
    const attempt = await prisma.messageDispatchAttempt.create({ data: { businessId: dispatch.businessId, dispatchId: dispatch.id, attempt: dispatch.attempts + 1, provider: dispatch.provider, status: "PROCESSING" } });
    try {
      const selectedProvider = provider?.id === dispatch.provider ? provider : getMessagingProvider(dispatch.provider) ?? provider;
      const result = await sendOutboundMessage({ to: dispatch.destination, channel: dispatch.channel as PlatformChannel, body: dispatch.message.body, countryCode: parsePhoneNumber(dispatch.destination).country ?? "ZZ", idempotencyKey: dispatch.idempotencyKey }, selectedProvider);
      if (!result.accepted) throw Object.assign(new Error("Provider rejected message"), { code: result.errorCode, permanent: result.permanentFailure });
      await prisma.$transaction([
        prisma.messageDispatch.update({ where: { id: dispatch.id }, data: { status: "ACCEPTED", providerMessageId: result.providerMessageId, attempts: { increment: 1 }, acceptedAt: new Date(), leaseOwner: null, leaseExpiresAt: null } }),
        prisma.messageDispatchAttempt.update({ where: { id: attempt.id }, data: { status: "ACCEPTED", completedAt: new Date() } }),
        prisma.message.update({ where: { id: dispatch.messageId }, data: { status: "sent", sentAt: new Date(), provider: dispatch.provider, providerMessageId: result.providerMessageId } }),
      ]);
    } catch (error) {
      const attempts = dispatch.attempts + 1;
      const permanent = Boolean((error as { permanent?: boolean }).permanent) || attempts >= dispatch.maxAttempts;
      const code = String((error as { code?: string }).code ?? "PROVIDER_ERROR");
      await prisma.$transaction([
        prisma.messageDispatch.update({ where: { id: dispatch.id }, data: { status: permanent ? "DEAD" : "RETRY", attempts, lastError: `${code}: ${error instanceof Error ? error.message : "Provider error"}`, nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 1_000 * 2 ** attempts)), leaseOwner: null, leaseExpiresAt: null, completedAt: permanent ? new Date() : null } }),
        prisma.messageDispatchAttempt.update({ where: { id: attempt.id }, data: { status: permanent ? "DEAD" : "RETRY", errorCode: code, retryable: !permanent, completedAt: new Date() } }),
        ...(permanent ? [prisma.message.update({ where: { id: dispatch.messageId }, data: { status: "failed", providerErrorCode: code } })] : []),
      ]);
    }
  }
  return claimed.length;
}

export async function recordDeliveryReceipt(input: { provider: string; providerEventId: string; providerMessageId: string; status: string; occurredAt?: Date; errorCode?: string; payload?: unknown }) {
  const dispatch = await prisma.messageDispatch.findFirst({ where: { provider: input.provider, providerMessageId: input.providerMessageId } });
  if (!dispatch) return null;
  return prisma.$transaction(async (tx) => {
    const receipt = await tx.messageReceipt.upsert({ where: { provider_providerEventId: { provider: input.provider, providerEventId: input.providerEventId } }, create: { businessId: dispatch.businessId, messageId: dispatch.messageId, provider: input.provider, providerEventId: input.providerEventId, providerMessageId: input.providerMessageId, status: input.status, errorCode: input.errorCode, occurredAt: input.occurredAt ?? new Date(), payloadHash: payloadHash(input.payload ?? input) }, update: {} });
    const normalized = input.status.toUpperCase();
    if (["DELIVERED", "READ", "FAILED"].includes(normalized)) {
      await tx.messageDispatch.update({ where: { id: dispatch.id }, data: { status: normalized, completedAt: receipt.occurredAt, lastError: input.errorCode } });
      await tx.message.update({ where: { id: dispatch.messageId }, data: normalized === "DELIVERED" ? { deliveredAt: receipt.occurredAt } : normalized === "READ" ? { readAt: receipt.occurredAt } : { status: "failed", providerErrorCode: input.errorCode } });
    }
    return receipt;
  });
}

export async function recordInboundMessage(input: { businessId: string; customerId?: string; from: string; channel: PlatformChannel; body: string; provider: string; providerMessageId: string }) {
  const normalized = input.body.trim().toLowerCase();
  return prisma.$transaction(async (tx) => {
    let conversation = await tx.conversation.findFirst({ where: { businessId: input.businessId, OR: [{ customerId: input.customerId }, { participants: { some: { externalAddress: input.from } } }], status: { in: ["OPEN", "PENDING"] }, deletedAt: null }, orderBy: { updatedAt: "desc" } });
    if (!conversation) conversation = await tx.conversation.create({ data: { businessId: input.businessId, customerId: input.customerId, status: "OPEN", participants: { create: { businessId: input.businessId, customerId: input.customerId, externalAddress: input.from, role: "CUSTOMER" } }, lifecycleEvents: { create: { businessId: input.businessId, type: "OPENED" } } } });
    const message = await tx.message.create({ data: { businessId: input.businessId, customerId: input.customerId, conversationId: conversation.id, messageType: "custom", channel: input.channel, body: input.body, status: "sent", direction: "INBOUND", actorType: "CUSTOMER", provider: input.provider, providerMessageId: input.providerMessageId, contents: { create: { businessId: input.businessId, contentType: "TEXT", body: input.body } } } });
    await tx.conversation.update({ where: { id: conversation.id }, data: { lastInboundAt: new Date(), waitingSince: new Date(), status: "OPEN" } });
    if (STOP_WORDS.has(normalized)) {
      await tx.suppression.upsert({ where: { businessId_channel_address: { businessId: input.businessId, channel: input.channel.toUpperCase(), address: input.from } }, create: { businessId: input.businessId, customerId: input.customerId, channel: input.channel.toUpperCase(), address: input.from, reason: "CUSTOMER_REPLY", source: "PROVIDER_WEBHOOK" }, update: { active: true, liftedAt: null } });
    } else if (START_WORDS.has(normalized)) {
      await tx.suppression.updateMany({ where: { businessId: input.businessId, channel: input.channel.toUpperCase(), address: input.from }, data: { active: false, liftedAt: new Date() } });
    }
    return message;
  });
}

export async function messagingAnalytics(businessId: string) {
  const [conversations, statuses, costs] = await Promise.all([
    prisma.conversation.groupBy({ by: ["status"], where: { businessId, deletedAt: null }, _count: true }),
    prisma.messageDispatch.groupBy({ by: ["status", "channel"], where: { businessId }, _count: true, _avg: { attempts: true } }),
    prisma.messagingCostEvent.aggregate({ where: { businessId, verified: true }, _sum: { amount: true } }),
  ]);
  return { conversations, delivery: statuses, verifiedCost: costs._sum.amount?.toString() ?? "0" };
}

export async function retryDispatch(businessId: string, id: string) {
  const result = await prisma.messageDispatch.updateMany({ where: { id, businessId, status: { in: ["DEAD", "FAILED"] } }, data: { status: "RETRY", attempts: 0, nextAttemptAt: new Date(), lastError: null, completedAt: null } });
  if (!result.count) throw ApiError.notFound("Failed dispatch not found");
}
