import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import type { Prisma } from "@prisma/client";
import { getCustomerProfileOrThrow, linkCustomerToBusiness, recordCustomerActivity } from "../../lib/customer/customerContext.js";
import { listCustomerNotifications, markAllNotificationsRead, markNotificationRead } from "../../lib/customer/customerNotifications.js";
import { revokeAllCustomerSessions } from "../customerAuth/customerAuth.service.js";
import { getCustomerAIContext, getCustomerAIConversations, getCustomerDashboard } from "./customer.service.js";
import { getOwnAcceptanceHistory, getPendingAcceptances, recordAcceptance, LEGAL_DOCUMENT_TYPES } from "../../lib/legal/legalDocuments.service.js";

const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  phoneE164: z.string().trim().max(20).nullable().optional(),
  preferredLanguage: z.string().trim().min(2).max(10).optional(),
  preferredTimezone: z.string().trim().min(2).max(60).optional(),
});
const preferencesSchema = z.object({
  notificationPreferences: z.record(z.string(), z.record(z.string(), z.boolean())).optional(),
  privacySettings: z.record(z.string(), z.unknown()).optional(),
  communicationPreferences: z.record(z.string(), z.unknown()).optional(),
  marketingConsent: z.boolean().optional(),
});
const favouriteSchema = z.object({ favourite: z.boolean() });
const notificationsQuery = z.object({ unreadOnly: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(200).optional() });
const cookiePreferencesSchema = z.object({ analytics: z.boolean(), functional: z.boolean(), marketing: z.boolean() });
const legalAcceptSchema = z.object({
  type: z.enum(LEGAL_DOCUMENT_TYPES),
  platform: z.string().trim().max(40).optional(),
  source: z.string().trim().max(60).default("app"),
  // Only meaningful when type === "COOKIE_POLICY". "accept_all"/"reject_optional"/
  // "customize" as the source value plus these booleans covers the brief's
  // required cookie-consent actions without a second consent mechanism.
  cookiePreferences: cookiePreferencesSchema.optional(),
});

export default async function customerRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticateCustomer);

  // --- Profile ---
  fastify.get("/profile", async (request) => {
    const profile = await getCustomerProfileOrThrow(request.customer!.profileId);
    return { ...profile, user: { id: profile.user.id, email: profile.user.email, fullName: profile.user.fullName, emailVerified: Boolean(profile.user.emailVerifiedAt) } };
  });

  fastify.patch("/profile", async (request) => {
    const input = updateProfileSchema.parse(request.body);
    return prisma.customerProfile.update({ where: { id: request.customer!.profileId }, data: { ...input } });
  });

  fastify.patch("/profile/preferences", async (request) => {
    const input = preferencesSchema.parse(request.body);
    const data: Prisma.CustomerProfileUpdateInput = {};
    if (input.notificationPreferences) data.notificationPreferences = input.notificationPreferences as Prisma.InputJsonValue;
    if (input.privacySettings) data.privacySettings = input.privacySettings as Prisma.InputJsonValue;
    if (input.communicationPreferences) data.communicationPreferences = input.communicationPreferences as Prisma.InputJsonValue;
    if (input.marketingConsent !== undefined) data.marketingConsent = input.marketingConsent;
    return prisma.customerProfile.update({ where: { id: request.customer!.profileId }, data });
  });

  fastify.delete("/profile", async (request, reply) => {
    await prisma.customerProfile.update({ where: { id: request.customer!.profileId }, data: { status: "DELETED" } });
    await revokeAllCustomerSessions(request.customer!.userId, "customer_account_closed");
    reply.status(204).send();
  });

  // --- Legal acceptance ---
  fastify.get("/legal/status", async (request) => {
    const pending = await getPendingAcceptances(request.customer!.userId, "CUSTOMER");
    return { pending };
  });

  fastify.get("/legal/history", async (request) => {
    const events = await getOwnAcceptanceHistory(request.customer!.userId, "CUSTOMER");
    return { events };
  });

  fastify.post("/legal/accept", async (request) => {
    const input = legalAcceptSchema.parse(request.body);
    return recordAcceptance({
      userId: request.customer!.userId,
      type: input.type,
      scope: "CUSTOMER",
      source: input.source,
      platform: input.platform,
      language: request.customer!.preferredLanguage,
      device: request.headers["user-agent"],
      ipAddress: request.ip,
      cookiePreferences: input.cookiePreferences,
      sessionId: request.customer!.sessionId,
    });
  });

  // --- Business relationships & favourites ---
  fastify.get("/businesses", async (request) => {
    const links = await prisma.customerBusinessLink.findMany({
      where: { customerProfileId: request.customer!.profileId },
      orderBy: [{ favourite: "desc" }, { lastInteractionAt: "desc" }],
    });
    const businesses = links.length
      ? await prisma.business.findMany({ where: { id: { in: [...new Set(links.map((link) => link.businessId))] } }, select: { id: true, name: true, industry: true, publicSlug: true } })
      : [];
    const byId = new Map(businesses.map((business) => [business.id, business]));
    return links.map((link) => ({ ...link, business: byId.get(link.businessId) ?? null }));
  });

  fastify.patch("/businesses/:businessId/favourite", async (request) => {
    const { businessId } = z.object({ businessId: z.string().uuid() }).parse(request.params);
    const { favourite } = favouriteSchema.parse(request.body);
    const business = await prisma.business.findFirst({ where: { id: businessId, platformStatus: "ACTIVE" }, select: { id: true } });
    if (!business) throw ApiError.notFound("Business not found");
    const link = await linkCustomerToBusiness({ customerProfileId: request.customer!.profileId, businessId, favourite });
    await recordCustomerActivity({ customerProfileId: request.customer!.profileId, businessId, type: favourite ? "BUSINESS_FAVOURITED" : "BUSINESS_UNFAVOURITED", entityType: "business", entityId: businessId });
    return link;
  });

  // --- Dashboard ---
  fastify.get("/dashboard", async (request) => getCustomerDashboard(request.customer!.profileId));

  fastify.get("/activity", async (request) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(200).optional() }).parse(request.query);
    return prisma.customerActivityEvent.findMany({ where: { customerProfileId: request.customer!.profileId }, orderBy: { createdAt: "desc" }, take: limit ?? 50 });
  });

  // --- Notifications ---
  fastify.get("/notifications", async (request) => {
    const query = notificationsQuery.parse(request.query);
    return listCustomerNotifications(request.customer!.profileId, query);
  });

  fastify.post("/notifications/:id/read", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return markNotificationRead(request.customer!.profileId, id);
  });

  fastify.post("/notifications/read-all", async (request) => markAllNotificationsRead(request.customer!.profileId));

  fastify.get("/notifications/preferences", async (request) => {
    const profile = await prisma.customerProfile.findUniqueOrThrow({ where: { id: request.customer!.profileId }, select: { notificationPreferences: true, communicationPreferences: true } });
    return profile;
  });

  fastify.patch("/notifications/preferences", async (request) => {
    const input = z.object({ notificationPreferences: z.record(z.string(), z.record(z.string(), z.boolean())) }).parse(request.body);
    return prisma.customerProfile.update({ where: { id: request.customer!.profileId }, data: { notificationPreferences: input.notificationPreferences as Prisma.InputJsonValue } });
  });

  // --- AI integration (reads only; LOOP 3 AI Platform is unchanged) ---
  fastify.get("/ai/conversations", async (request) => getCustomerAIConversations(request.customer!.profileId));
  fastify.get("/ai/context", async (request) => {
    const context = await getCustomerAIContext(request.customer!.profileId);
    if (!context) throw ApiError.notFound("Customer profile not found");
    return context;
  });
}
