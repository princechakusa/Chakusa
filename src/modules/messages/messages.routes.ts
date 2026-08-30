import type { FastifyInstance } from "fastify";
import { sendMessageSchema } from "./messages.schemas.js";
import { sendDurableMessage } from "./durableMessages.service.js";
import { prisma } from "../../lib/prisma.js";
import { messagingAnalytics, retryDispatch } from "../../lib/messaging/messagingPlatform.js";
import { ApiError } from "../../lib/errors.js";
import { z } from "zod";

export default async function messageRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  // The only route in this phase — one explicitly, humanly initiated send.
  // request.businessId and request.plan are both server-resolved by
  // tenant.ts from the authenticated user's trusted membership/subscription;
  // sendMessageSchema has no `businessId`/`plan` field, so nothing the
  // client sends can override either.
  fastify.post("/send", async (request, reply) => {
    const input = sendMessageSchema.parse(request.body);
    const message = await sendDurableMessage(request.businessId!, input, request.plan!, request.status!);
    reply.status(201).send(message);
  });

  fastify.get("/conversations", async (request) => {
    const query = z.object({ status: z.string().optional(), cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    return prisma.conversation.findMany({ where: { businessId: request.businessId!, deletedAt: null, status: query.status }, include: { messages: { orderBy: { createdAt: "desc" }, take: 1 }, slas: { where: { status: "ACTIVE" } } }, orderBy: [{ priority: "desc" }, { updatedAt: "desc" }], take: query.limit, ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}) });
  });

  fastify.get("/conversations/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const conversation = await prisma.conversation.findFirst({ where: { id, businessId: request.businessId!, deletedAt: null }, include: { participants: true, assignments: { orderBy: { startedAt: "desc" } }, lifecycleEvents: { orderBy: { createdAt: "asc" } }, notes: { orderBy: { createdAt: "asc" } }, messages: { where: { deletedAt: null }, include: { contents: true, attachments: true, dispatches: { include: { attemptsHistory: true } }, receipts: true }, orderBy: { createdAt: "asc" } } } });
    if (!conversation) throw ApiError.notFound("Conversation not found");
    return conversation;
  });

  fastify.patch("/conversations/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ status: z.enum(["OPEN", "PENDING", "RESOLVED", "ARCHIVED"]).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), assignedMemberId: z.string().uuid().nullable().optional(), automationMode: z.enum(["AUTOMATED", "HUMAN", "PAUSED"]).optional() }).parse(request.body);
    const result = await prisma.conversation.updateMany({ where: { id, businessId: request.businessId!, deletedAt: null }, data: body });
    if (!result.count) throw ApiError.notFound("Conversation not found");
    await prisma.conversationLifecycleEvent.create({ data: { businessId: request.businessId!, conversationId: id, type: "UPDATED", actorId: request.user?.userId, metadata: body } });
    return prisma.conversation.findUnique({ where: { id } });
  });

  fastify.post("/conversations/:id/notes", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const { body } = z.object({ body: z.string().trim().min(1).max(5000) }).parse(request.body);
    const conversation = await prisma.conversation.findFirst({ where: { id, businessId: request.businessId!, deletedAt: null }, select: { id: true } });
    if (!conversation) throw ApiError.notFound("Conversation not found");
    const note = await prisma.internalConversationNote.create({ data: { businessId: request.businessId!, conversationId: id, authorId: request.user!.userId, body } });
    reply.status(201).send(note);
  });

  fastify.get("/analytics", async (request) => messagingAnalytics(request.businessId!));
  fastify.get("/failures", async (request) => prisma.messageDispatch.findMany({ where: { businessId: request.businessId!, status: { in: ["DEAD", "FAILED", "RETRY"] } }, include: { message: true, attemptsHistory: true }, orderBy: { updatedAt: "desc" }, take: 100 }));
  fastify.post("/failures/:id/retry", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await retryDispatch(request.businessId!, id);
    reply.status(202).send({ queued: true });
  });
}
