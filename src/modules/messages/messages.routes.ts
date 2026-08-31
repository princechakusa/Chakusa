import type { FastifyInstance } from "fastify";
import { sendMessageSchema } from "./messages.schemas.js";
import { sendDurableMessage } from "./durableMessages.service.js";
import { prisma } from "../../lib/prisma.js";
import { messagingAnalytics, retryDispatch } from "../../lib/messaging/messagingPlatform.js";
import { ApiError } from "../../lib/errors.js";
import { z } from "zod";
import { bulkConversationUpdate, completeMessagingAnalytics, createMessagingTemplate, createTemplateVersion, initializeConversationSLAs, maskedCredentials, mergeConversations, publishTemplate, renderTemplate, rollbackTemplate, splitConversation, storeProviderCredential, validateTemplate } from "../../lib/messaging/messagingOperations.js";
import { attachmentStorageHealth, createAttachmentDownload, downloadAttachment, initiateAttachment, rescanAttachment, uploadAttachment } from "../../lib/messaging/attachmentPlatform.js";
import { requireBusinessRole } from "../../lib/authorization.js";
import { getProviderCredentialVerifier } from "../../lib/messaging/providerRegistry.js";

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

  fastify.post("/attachments", async (request, reply) => { const input = z.object({ messageId: z.string().uuid().optional(), fileName: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(3).max(120), sizeBytes: z.number().int().positive().max(20 * 1024 * 1024), checksumSha256: z.string().length(64), retentionDays: z.number().int().min(1).max(365).optional() }).parse(request.body); reply.status(201).send(await initiateAttachment(request.businessId!, input)); });
  fastify.put("/attachments/upload/:token", { config: { bodyLimit: 28 * 1024 * 1024 } }, async (request) => { const { token } = z.object({ token: z.string().min(20) }).parse(request.params); const { dataBase64, contentType } = z.object({ dataBase64: z.string().min(1), contentType: z.string().min(3).max(120) }).parse(request.body); return uploadAttachment(token, Buffer.from(dataBase64, "base64"), contentType); });
  fastify.post("/attachments/:id/download", async (request) => { const { id } = z.object({ id: z.string().uuid() }).parse(request.params); return createAttachmentDownload(request.businessId!, id); });
  fastify.get("/attachments/download/:token", async (request, reply) => { const { token } = z.object({ token: z.string().min(20) }).parse(request.params); const result = await downloadAttachment(token); reply.header("content-type", result.attachment.detectedMime ?? result.attachment.declaredMime).header("content-disposition", `attachment; filename="${result.attachment.fileName.replace(/["\r\n]/g, "_")}"`).send(result.body); });
  fastify.post("/attachments/:id/rescan", async (request, reply) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); await rescanAttachment(request.businessId!, id); reply.status(202).send({ queued: true }); });
  fastify.get("/attachments/storage-status", async () => attachmentStorageHealth());

  fastify.get("/templates", async (request) => prisma.messagingTemplate.findMany({ where: { OR: [{ businessId: request.businessId! }, { businessId: null }], deletedAt: null }, include: { versions: { orderBy: [{ locale: "asc" }, { version: "desc" }] } }, orderBy: { name: "asc" } }));
  fastify.post("/templates", async (request, reply) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); const input = z.object({ key: z.string().regex(/^[A-Z0-9_]{2,80}$/), name: z.string().min(1).max(120), purpose: z.string().min(1).max(40), industry: z.string().max(80).optional(), channel: z.enum(["sms", "whatsapp"]), locale: z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/), body: z.string().min(1).max(5000), subject: z.string().max(200).optional(), variables: z.array(z.string().regex(/^[a-zA-Z][\w.]*$/)).max(50) }).parse(request.body); reply.status(201).send(await createMessagingTemplate(request.businessId!, input)); });
  fastify.post("/templates/:id/versions", async (request, reply) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const input = z.object({ channel: z.enum(["sms", "whatsapp"]), locale: z.string(), body: z.string().min(1).max(5000), subject: z.string().max(200).optional(), variables: z.array(z.string()).max(50) }).parse(request.body); reply.status(201).send(await createTemplateVersion(request.businessId!, id, input)); });
  fastify.post("/templates/versions/:id/publish", async (request) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); return publishTemplate(request.businessId!, z.object({ id: z.string().uuid() }).parse(request.params).id); });
  fastify.post("/templates/:id/rollback", async (request) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const input = z.object({ version: z.number().int().positive(), channel: z.string(), locale: z.string() }).parse(request.body); return rollbackTemplate(request.businessId!, id, input.version, input.channel, input.locale); });
  fastify.post("/templates/preview", async (request) => { const input = z.object({ body: z.string(), variables: z.array(z.string()), values: z.record(z.string(), z.unknown()) }).parse(request.body); const validation = validateTemplate(input.body, input.variables); return { validation, rendered: validation.valid ? renderTemplate(input.body, input.values) : null }; });

  fastify.get("/credentials", async (request) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); return maskedCredentials(request.businessId!); });
  fastify.post("/credentials", async (request, reply) => { requireBusinessRole(request, ["OWNER"]); const input = z.object({ channelAccountId: z.string().uuid(), credential: z.record(z.string(), z.unknown()).refine(value => Object.keys(value).length > 0) }).parse(request.body); const account = await prisma.messagingChannelAccount.findFirst({ where: { id: input.channelAccountId, businessId: request.businessId!, deletedAt: null }, select: { provider: true } }); const verifier = account ? getProviderCredentialVerifier(account.provider) : undefined; if (!verifier) throw ApiError.serviceUnavailable("Provider credential verification is not configured"); const created = await storeProviderCredential(request.businessId!, request.user.userId, input.channelAccountId, input.credential, verifier); reply.status(201).send({ id: created.id, keyVersion: created.keyVersion, validationStatus: created.validationStatus, createdAt: created.createdAt }); });
  fastify.get("/provider-health", async (request) => prisma.messagingChannelAccount.findMany({ where: { businessId: request.businessId!, deletedAt: null }, select: { id: true, provider: true, channel: true, status: true, healthStatus: true, lastHealthAt: true, capabilities: true } }));

  fastify.post("/conversations/bulk", async (request) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); const input = z.object({ ids: z.array(z.string().uuid()).min(1).max(100), status: z.string().optional(), assignedMemberId: z.string().uuid().nullable().optional(), archive: z.boolean().optional() }).parse(request.body); return { updated: await bulkConversationUpdate(request.businessId!, input.ids, input, request.user.userId) }; });
  fastify.post("/conversations/:id/merge", async (request) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const { sourceIds } = z.object({ sourceIds: z.array(z.string().uuid()).min(1).max(20) }).parse(request.body); return mergeConversations(request.businessId!, id, sourceIds, request.user.userId); });
  fastify.post("/conversations/:id/split", async (request, reply) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const { messageIds } = z.object({ messageIds: z.array(z.string().uuid()).min(1).max(100) }).parse(request.body); reply.status(201).send(await splitConversation(request.businessId!, id, messageIds, request.user.userId)); });
  fastify.post("/conversations/:id/slas", async (request, reply) => { requireBusinessRole(request, ["OWNER", "ADMIN"]); const { id } = z.object({ id: z.string().uuid() }).parse(request.params); const input = z.object({ firstResponse: z.number().int().positive(), resolution: z.number().int().positive(), assignment: z.number().int().positive(), escalation: z.number().int().positive() }).parse(request.body); reply.status(201).send(await initializeConversationSLAs(request.businessId!, id, input)); });
  fastify.get("/analytics/complete", async (request) => completeMessagingAnalytics(request.businessId!));
}
