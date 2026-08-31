import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { enqueueMessage } from "../../lib/messaging/messagingPlatform.js";
import { deliverAIReply } from "../../lib/ai/agent/customerAgent.js";
import { recordConversationEvent } from "../../lib/ai/memory/summarization.js";
import { approveSchema, rejectSchema, replySchema, takeoverSchema, transferSchema } from "./aiAgent.schemas.js";

const idParams = z.object({ id: z.string().uuid() });

async function ownedConversation(businessId: string, id: string) {
  const conversation = await prisma.conversation.findFirst({ where: { id, businessId, deletedAt: null } });
  if (!conversation) throw ApiError.notFound("Conversation not found");
  return conversation;
}

async function callerMemberId(businessId: string, userId: string) {
  const member = await prisma.businessMember.findFirst({ where: { businessId, userId }, select: { id: true } });
  return member?.id ?? null;
}

/**
 * LOOP 4 — Human collaboration for the AI Customer Agent. Takeover, resume,
 * ownership transfer, manual intervention, and AI-draft approve/reject. All
 * reuse the existing Conversation model, lifecycle events and the durable
 * Messaging Platform send — no new messaging surface.
 */
export default async function aiAgentRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.post("/conversations/:id/takeover", async (request) => {
    const { id } = idParams.parse(request.params);
    takeoverSchema.parse(request.body ?? {});
    await ownedConversation(request.businessId!, id);
    const memberId = await callerMemberId(request.businessId!, request.user!.userId);
    await prisma.conversation.update({ where: { id }, data: { automationMode: "HUMAN", assignedMemberId: memberId ?? undefined } });
    await prisma.conversationLifecycleEvent.create({ data: { businessId: request.businessId!, conversationId: id, type: "AI_TAKEOVER", actorId: request.user!.userId } });
    return prisma.conversation.findUniqueOrThrow({ where: { id } });
  });

  fastify.post("/conversations/:id/resume", async (request) => {
    const { id } = idParams.parse(request.params);
    await ownedConversation(request.businessId!, id);
    await prisma.conversation.update({ where: { id }, data: { automationMode: "AUTOMATED" } });
    await prisma.conversationLifecycleEvent.create({ data: { businessId: request.businessId!, conversationId: id, type: "AI_RESUMED", actorId: request.user!.userId } });
    return prisma.conversation.findUniqueOrThrow({ where: { id } });
  });

  fastify.post("/conversations/:id/transfer", async (request) => {
    const { id } = idParams.parse(request.params);
    const input = transferSchema.parse(request.body);
    await ownedConversation(request.businessId!, id);
    const member = await prisma.businessMember.findFirst({ where: { id: input.memberId, businessId: request.businessId!, status: "ACTIVE" }, select: { id: true } });
    if (!member) throw ApiError.badRequest("memberId must be an active member of this business");
    await prisma.conversation.update({ where: { id }, data: { assignedMemberId: member.id } });
    await prisma.conversationLifecycleEvent.create({ data: { businessId: request.businessId!, conversationId: id, type: "OWNERSHIP_TRANSFERRED", actorId: request.user!.userId, metadata: { toMemberId: member.id, note: input.note ?? null } } });
    return prisma.conversation.findUniqueOrThrow({ where: { id } });
  });

  fastify.post("/conversations/:id/reply", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const input = replySchema.parse(request.body);
    const conversation = await ownedConversation(request.businessId!, id);
    if (!conversation.customerId) throw ApiError.badRequest("This conversation has no customer to reply to");
    const message = await enqueueMessage(
      { businessId: request.businessId!, customerId: conversation.customerId, body: input.body, messageType: "custom", channel: "sms", purpose: "SERVICE", actorType: "HUMAN", actorId: request.user!.userId, idempotencyKey: `manual:${id}:${Date.now()}` },
      request.plan!,
      request.status!,
    );
    if (input.pauseAI) await prisma.conversation.update({ where: { id }, data: { automationMode: "HUMAN" } });
    await prisma.conversationLifecycleEvent.create({ data: { businessId: request.businessId!, conversationId: id, type: "MANUAL_INTERVENTION", actorId: request.user!.userId } });
    reply.status(201).send(message);
  });

  fastify.post("/runs/:id/approve", async (request) => {
    const { id } = idParams.parse(request.params);
    const input = approveSchema.parse(request.body ?? {});
    const run = await prisma.aIConversationRun.findFirst({ where: { id, businessId: request.businessId! } });
    if (!run) throw ApiError.notFound("AI conversation run not found");
    if (run.status !== "HUMAN_APPROVAL") throw ApiError.badRequest("Only a run awaiting approval can be approved");
    if (!run.customerId) throw ApiError.badRequest("This run has no customer to reply to");
    const state = (run.state ?? {}) as { pendingReply?: unknown; channel?: unknown };
    const body = input.edit ?? (typeof state.pendingReply === "string" ? state.pendingReply : "");
    if (!body) throw ApiError.badRequest("There is no drafted reply to send");
    const channel = state.channel === "whatsapp" ? "whatsapp" : "sms";
    await deliverAIReply({ businessId: request.businessId!, customerId: run.customerId, conversationId: run.conversationId, runId: run.id, body, channel, plan: request.plan!, status: request.status! });
    await prisma.message.deleteMany({ where: { businessId: request.businessId!, conversationId: run.conversationId, status: "draft", actorType: "AI" } });
    await recordConversationEvent({ businessId: request.businessId!, conversationId: run.conversationId, runId: run.id, customerId: run.customerId, kind: "human_intervention", content: `AI draft ${input.edit ? "edited and " : ""}approved by ${request.user!.userId}.` });
    return prisma.aIConversationRun.findUniqueOrThrow({ where: { id: run.id } });
  });

  fastify.post("/runs/:id/reject", async (request) => {
    const { id } = idParams.parse(request.params);
    const input = rejectSchema.parse(request.body ?? {});
    const run = await prisma.aIConversationRun.findFirst({ where: { id, businessId: request.businessId! } });
    if (!run) throw ApiError.notFound("AI conversation run not found");
    if (run.status !== "HUMAN_APPROVAL") throw ApiError.badRequest("Only a run awaiting approval can be rejected");
    await prisma.message.deleteMany({ where: { businessId: request.businessId!, conversationId: run.conversationId, status: "draft", actorType: "AI" } });
    const next = input.escalate ? "ESCALATED" : "FAILED";
    await prisma.aIConversationRun.update({ where: { id: run.id }, data: { status: next, lastError: input.reason ?? "Draft rejected by a human" } });
    if (input.escalate) {
      await prisma.conversation.updateMany({ where: { id: run.conversationId, businessId: request.businessId! }, data: { automationMode: "HUMAN", status: "PENDING" } });
    }
    await recordConversationEvent({ businessId: request.businessId!, conversationId: run.conversationId, runId: run.id, customerId: run.customerId ?? undefined, kind: "human_intervention", content: `AI draft rejected by ${request.user!.userId}${input.escalate ? " and escalated" : ""}.` });
    return prisma.aIConversationRun.findUniqueOrThrow({ where: { id: run.id } });
  });
}
