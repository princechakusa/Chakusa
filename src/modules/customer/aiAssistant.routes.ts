import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import {
  createAssistantConversation,
  deleteAssistantConversation,
  getAssistantConversation,
  listAssistantConversations,
  rateAssistantMessage,
  sendAssistantMessage,
  updateAssistantConversation,
} from "../../lib/ai/customerAssistant/conversations.js";
import { buildCustomerAssistantContext, readAssistantSettings, updateAssistantSettings, buildPersonalizationProfile } from "../../lib/ai/customerAssistant/context.js";
import { recommendForCustomer } from "../../lib/ai/customerAssistant/recommendations.js";

// PROGRAM 2 LOOP 4 — Customer AI Assistant HTTP surface. authenticateCustomer
// only; every handler is scoped to request.customer.profileId. The turn
// itself is executed by the AI Platform (see customerAssistant.ts).

const idParam = z.object({ id: z.string().uuid() });

export default async function customerAIAssistantRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticateCustomer);

  fastify.post("/conversations", async (request, reply) => {
    const body = z.object({ title: z.string().trim().max(120).optional(), businessSlug: z.string().trim().max(200).optional() }).parse(request.body ?? {});
    reply.status(201).send(await createAssistantConversation(request.customer!.profileId, body));
  });

  fastify.get("/conversations", async (request) => {
    const query = z.object({
      archived: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true")),
      q: z.string().trim().max(120).optional(),
      cursor: z.string().uuid().optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    }).parse(request.query);
    return listAssistantConversations(request.customer!.profileId, query);
  });

  fastify.get("/conversations/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    const query = z.object({ cursor: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(100).optional() }).parse(request.query);
    return getAssistantConversation(request.customer!.profileId, id, query);
  });

  fastify.post("/conversations/:id/messages", async (request, reply) => {
    const { id } = idParam.parse(request.params);
    const { content } = z.object({ content: z.string().trim().min(1).max(2000) }).parse(request.body);
    reply.status(201).send(await sendAssistantMessage(request.customer!.profileId, id, content));
  });

  fastify.patch("/conversations/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    const patch = z.object({ title: z.string().trim().max(120).optional(), pinned: z.boolean().optional(), archived: z.boolean().optional() }).parse(request.body);
    return updateAssistantConversation(request.customer!.profileId, id, patch);
  });

  fastify.delete("/conversations/:id", async (request) => {
    const { id } = idParam.parse(request.params);
    return deleteAssistantConversation(request.customer!.profileId, id);
  });

  fastify.post("/messages/:id/feedback", async (request) => {
    const { id } = idParam.parse(request.params);
    const body = z.object({ rating: z.number().int().min(-1).max(1), note: z.string().trim().max(1000).optional() }).parse(request.body);
    return rateAssistantMessage(request.customer!.profileId, id, body.rating, body.note);
  });

  fastify.get("/context", async (request) => buildCustomerAssistantContext(request.customer!.profileId));

  fastify.get("/personalization", async (request) => buildPersonalizationProfile(request.customer!.profileId));

  fastify.get("/recommendations", async (request) => {
    const query = z.object({ lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(), limit: z.coerce.number().int().min(1).max(15).optional() }).parse(request.query);
    return { recommendations: await recommendForCustomer(request.customer!.profileId, query) };
  });

  fastify.get("/settings", async (request) => {
    const profile = await prisma.customerProfile.findUniqueOrThrow({
      where: { id: request.customer!.profileId },
      select: { preferredLanguage: true, privacySettings: true, communicationPreferences: true, notificationPreferences: true },
    });
    return readAssistantSettings(profile);
  });

  fastify.patch("/settings", async (request) => {
    const patch = z.object({
      personalizationEnabled: z.boolean().optional(),
      memoryEnabled: z.boolean().optional(),
      recommendationsEnabled: z.boolean().optional(),
      language: z.string().trim().min(2).max(10).optional(),
      notifyOnReply: z.boolean().optional(),
      notifyRecommendations: z.boolean().optional(),
    }).parse(request.body);
    return updateAssistantSettings(request.customer!.profileId, patch);
  });
}
