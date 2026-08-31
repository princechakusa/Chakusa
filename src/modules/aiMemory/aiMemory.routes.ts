import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireBusinessRole } from "../../lib/authorization.js";
import { deleteMemory, listMemory, pruneExpiredMemory, updateMemory, writeMemory, getSession } from "../../lib/ai/memory/memoryStore.js";
import { deriveBusinessKnowledge, deriveConversationKnowledge, deriveCustomerKnowledge, deriveLongTermKnowledge } from "../../lib/ai/memory/knowledgeSources.js";
import { retrieveMemory } from "../../lib/ai/memory/retrievalEngine.js";
import { retrievalMonitoring } from "./aiMemory.service.js";
import { createRecordSchema, monitoringQuerySchema, retrieveSchema, updateRecordSchema } from "./aiMemory.schemas.js";

const idParams = z.object({ id: z.string().uuid() });
const MANAGE_ROLES = ["OWNER", "ADMIN"] as const;

export default async function aiMemoryRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/business", async (request) => {
    const businessId = request.businessId!;
    const [records, derivedKnowledge, longTerm] = await Promise.all([
      listMemory(businessId, { scope: "BUSINESS" }),
      deriveBusinessKnowledge(businessId),
      deriveLongTermKnowledge(businessId),
    ]);
    return { stored: records, derived: [...derivedKnowledge, ...longTerm] };
  });

  fastify.get("/customers/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const businessId = request.businessId!;
    const [stored, derived] = await Promise.all([
      listMemory(businessId, { scope: "CUSTOMER", customerId: id }),
      deriveCustomerKnowledge(businessId, id),
    ]);
    return { stored, derived };
  });

  fastify.get("/conversations/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const businessId = request.businessId!;
    const [stored, derived] = await Promise.all([
      listMemory(businessId, { conversationId: id }),
      deriveConversationKnowledge(businessId, id),
    ]);
    return { stored, derived };
  });

  fastify.get("/sessions/:id", async (request, reply) => {
    const { id } = idParams.parse(request.params);
    const session = await getSession(request.businessId!, id);
    if (!session) return reply.status(404).send({ error: { code: "NOT_FOUND", message: "Session not found" } });
    return session;
  });

  fastify.post("/records", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const input = createRecordSchema.parse(request.body);
    const record = await writeMemory({
      businessId: request.businessId!,
      scope: input.scope,
      kind: input.kind,
      title: input.title ?? null,
      content: input.content,
      data: input.data,
      customerId: input.customerId ?? null,
      conversationId: input.conversationId ?? null,
      subjectType: input.subjectType ?? null,
      subjectId: input.subjectId ?? null,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      confidence: input.confidence ?? null,
      importance: input.importance,
      pinned: input.pinned,
      ttlMinutes: input.ttlMinutes ?? null,
      createdByUserId: request.user!.userId,
    });
    reply.status(201).send(record);
  });

  fastify.patch("/records/:id", async (request) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const { id } = idParams.parse(request.params);
    const input = updateRecordSchema.parse(request.body);
    return updateMemory(request.businessId!, id, {
      content: input.content,
      title: input.title,
      data: input.data,
      importance: input.importance,
      pinned: input.pinned,
      confidence: input.confidence,
      expiresAt: input.ttlMinutes ? new Date(Date.now() + input.ttlMinutes * 60_000) : undefined,
    });
  });

  fastify.delete("/records/:id", async (request, reply) => {
    requireBusinessRole(request, MANAGE_ROLES);
    const { id } = idParams.parse(request.params);
    await deleteMemory(request.businessId!, id);
    reply.status(204).send();
  });

  fastify.post("/retrieve", async (request) => {
    const input = retrieveSchema.parse(request.body);
    // Preview: deterministic, does not persist an AIRetrievalLog row.
    return retrieveMemory({ businessId: request.businessId!, ...input, persistLog: false });
  });

  fastify.get("/monitoring", async (request) => {
    const { sinceHours } = monitoringQuerySchema.parse(request.query);
    return retrievalMonitoring(request.businessId!, sinceHours);
  });

  fastify.post("/prune", async (request) => {
    requireBusinessRole(request, MANAGE_ROLES);
    return pruneExpiredMemory(request.businessId!);
  });
}
