import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import type { CountryCode } from "libphonenumber-js";
import { prisma } from "../../lib/prisma.js";
import { ApiError } from "../../lib/errors.js";
import { toE164OrNull } from "../../lib/phone.js";
import { generatePublicSlug } from "../../lib/publicSlug.js";
import { updateBusinessSchema, createBusinessSchema } from "./business.schemas.js";
import { completeBusinessOnboarding } from "./business.service.js";
import { exportBusinessData } from './businessExport.service.js';
import { requireOwner } from '../../lib/authorization.js';
import { syncServiceOfferingsFromLegacyNames } from '../services/services.service.js';
import { getPendingAcceptances, recordAcceptance, LEGAL_DOCUMENT_TYPES } from "../../lib/legal/legalDocuments.service.js";
import { z } from "zod";

const cookiePreferencesSchema = z.object({ analytics: z.boolean(), functional: z.boolean(), marketing: z.boolean() });
const legalAcceptSchema = z.object({
  type: z.enum(LEGAL_DOCUMENT_TYPES),
  platform: z.string().trim().max(40).optional(),
  source: z.string().trim().max(60).default("app"),
  cookiePreferences: cookiePreferencesSchema.optional(),
});

export default async function businessRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.get("/", { preHandler: fastify.requireBusiness }, async (request, reply) => {
    const business = await prisma.business.findUnique({ where: { id: request.businessId } });
    if (!business) throw ApiError.notFound("Business not found");
    reply.send(business);
  });

  // --- Legal acceptance (Program 2 Loop 4) ---
  fastify.get("/legal/status", async (request) => {
    const pending = await getPendingAcceptances(request.user.userId, "BUSINESS");
    return { pending };
  });

  fastify.post("/legal/accept", async (request) => {
    const input = legalAcceptSchema.parse(request.body);
    return recordAcceptance({
      userId: request.user.userId,
      type: input.type,
      scope: "BUSINESS",
      source: input.source,
      platform: input.platform,
      device: request.headers["user-agent"],
      ipAddress: request.ip,
      cookiePreferences: input.cookiePreferences,
    });
  });

  // MVP: one business per user, created during registration. This allows
  // creating an additional business for a user with no existing membership.
  fastify.post("/", async (request, reply) => {
    const input = createBusinessSchema.parse(request.body);
    const userId = request.user.userId;

    const existing = await prisma.businessMember.findFirst({ where: { userId } });
    if (existing) {
      throw ApiError.conflict("User already belongs to a business");
    }

    // No country is collectible at creation yet (no onboarding flow for it
    // in this phase), so only an already-international ("+…") phone can
    // normalize here — a bare local number stays un-derived until the
    // business sets its country via PATCH /business.
    const phoneE164 = toE164OrNull(input.phone);
    const publicSlug = await generatePublicSlug(input.name);

    const business = await prisma.$transaction(async (tx) => {
      const created = await tx.business.create({
        data: { ownerId: userId, name: input.name, industry: input.industry, phone: input.phone, phoneE164, publicSlug },
      });
      await tx.businessMember.create({
        data: { businessId: created.id, userId, role: "OWNER" },
      });
      await tx.subscription.create({ data: { businessId: created.id } });
      return created;
    });

    reply.status(201).send(business);
  });

  fastify.patch("/", { preHandler: fastify.requireBusiness }, async (request, reply) => {
    const input = updateBusinessSchema.parse(request.body);

    // Best-effort E.164 derivation, never blocking the write — if `phone`
    // isn't in this request, phoneE164 is left untouched (undefined field);
    // if it is, normalize against whichever country applies after this
    // update (the newly-set one, falling back to whatever's already
    // stored).
    let phoneE164: string | null | undefined;
    if (input.phone !== undefined) {
      const country = input.country ?? (await prisma.business.findUnique({
        where: { id: request.businessId },
        select: { country: true },
      }))?.country;
      phoneE164 = toE164OrNull(input.phone, (country as CountryCode | null) ?? undefined);
    }

    const business = await prisma.business.update({
      where: { id: request.businessId },
      data: {
        name: input.name,
        industry: input.industry,
        phone: input.phone,
        phoneE164,
        country: input.country,
        timezone: input.timezone,
        currency: input.currency,
        googleReviewLink: input.googleReviewLink,
        description: input.description,
        workingHours: input.workingHours as Prisma.InputJsonValue | undefined,
        defaultServices: input.defaultServices as Prisma.InputJsonValue | undefined,
        reminderDays: input.reminderDays,
        preferredTone: input.preferredTone,
        bookingMinNoticeMinutes: input.bookingMinNoticeMinutes,
        bookingWindowDays: input.bookingWindowDays,
        slotIntervalMinutes: input.slotIntervalMinutes,
        cancellationNoticeMinutes: input.cancellationNoticeMinutes,
        defaultAppointmentReminderMinutes: input.defaultAppointmentReminderMinutes,
        messagingConsentConfirmedAt: input.messagingConsentConfirmed === undefined ? undefined : input.messagingConsentConfirmed ? new Date() : null,
        paymentRemindersEnabled: input.paymentRemindersEnabled,
      },
    });

    if (input.defaultServices) await syncServiceOfferingsFromLegacyNames(request.businessId!, input.defaultServices);

    reply.send(business);
  });

  fastify.post("/onboarding/complete", { preHandler: fastify.requireBusiness }, async (request, reply) => {
    if (request.role !== "OWNER") throw ApiError.forbidden("Only the business owner can complete business setup");
    reply.send(await completeBusinessOnboarding(request.businessId!));
  });

  fastify.get('/export', { preHandler: fastify.requireBusiness }, async (request, reply) => {
    requireOwner(request);
    reply.header('content-disposition', `attachment; filename="chakusa-business-${request.businessId}.json"`);
    reply.send(await exportBusinessData(request.businessId!));
  });
}
