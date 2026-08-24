import type { FastifyInstance } from "fastify";
import { ApiError } from "../../lib/errors.js";
import { createPublicBookingSchema, publicAvailabilitySchema, reschedulePublicBookingSchema, submitPublicContactSchema } from "./public.schemas.js";
import { cancelPublicBooking, confirmPublicBooking, createPublicBooking, publicAvailability, publicBookingCalendar, reschedulePublicBooking, resolvePublicBooking, resolvePublicBusinessProfile, submitPublicContactForm } from "./publicBusinessProfile.service.js";
import { createAppointmentPaymentLink } from "../payments/payments.service.js";
import { paymentLinkSchema } from "../payments/payments.schemas.js";

/**
 * Unauthenticated, permanent-link routes for a business's public profile
 * page — see the schema comment on Business.publicSlug. Same rate-limit and
 * minimal-exposure discipline as public.routes.ts.
 */
export default async function publicBusinessProfileRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { slug: string } }>(
    "/:slug",
    // A shared/bookmarked business page reasonably reloads often; 30/min per
    // IP absorbs that while still bounding slug-enumeration traffic.
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const profile = await resolvePublicBusinessProfile(request.params.slug);
      if (!profile) {
        throw ApiError.notFound("This business page is invalid or no longer available");
      }
      reply.send(profile);
    },
  );

  fastify.post<{ Params: { slug: string } }>(
    "/:slug/contact",
    // A genuine customer submits once; 10/min per IP still allows a retry
    // after a network hiccup without meaningfully opening the door to abuse.
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const input = submitPublicContactSchema.parse(request.body);
      const result = await submitPublicContactForm(request.params.slug, input);
      if (!result) {
        throw ApiError.notFound("This business page is invalid or no longer available");
      }
      reply.status(201).send({ state: "submitted", businessName: result.businessName });
    },
  );
  fastify.get<{ Params: { slug: string } }>("/:slug/availability", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const input = publicAvailabilitySchema.parse(request.query); const result = await publicAvailability(request.params.slug, input.serviceOfferingId, input.from, input.to);
    if (!result) throw ApiError.notFound("This business page is invalid or no longer available"); reply.send(result);
  });
  fastify.post<{ Params: { slug: string } }>("/:slug/book", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    const result = await createPublicBooking(request.params.slug, createPublicBookingSchema.parse(request.body));
    if (!result) throw ApiError.notFound("This business page is invalid or no longer available"); reply.status(201).send(result);
  });
  fastify.get<{ Params: { slug: string; token: string } }>("/:slug/bookings/:token", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const result = await resolvePublicBooking(request.params.slug, request.params.token); if (!result) throw ApiError.notFound("This booking link is invalid or expired"); reply.send(result);
  });
  fastify.post<{ Params: { slug: string; token: string } }>("/:slug/bookings/:token/cancel", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    const result = await cancelPublicBooking(request.params.slug, request.params.token); if (!result) throw ApiError.notFound("This booking link is invalid or expired"); reply.send(result);
  });
  fastify.post<{ Params: { slug: string; token: string } }>("/:slug/bookings/:token/confirm", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    const result = await confirmPublicBooking(request.params.slug, request.params.token); if (!result) throw ApiError.notFound("This booking link is invalid or expired"); reply.send(result);
  });
  fastify.post<{ Params: { slug: string; token: string } }>("/:slug/bookings/:token/reschedule", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    const result = await reschedulePublicBooking(request.params.slug, request.params.token, reschedulePublicBookingSchema.parse(request.body)); if (!result) throw ApiError.notFound("This booking link is invalid or expired"); reply.send(result);
  });
  fastify.get<{ Params: { slug: string; token: string } }>("/:slug/bookings/:token/calendar.ics", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const result = await publicBookingCalendar(request.params.slug, request.params.token); if (!result) throw ApiError.notFound("This booking link is invalid or expired"); reply.header("content-type", "text/calendar; charset=utf-8").header("content-disposition", 'attachment; filename="appointment.ics"').send(result);
  });
  fastify.post<{ Params: { slug: string; token: string } }>("/:slug/bookings/:token/payment-link", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    const appointment = await resolvePublicBooking(request.params.slug, request.params.token); if (!appointment) throw ApiError.notFound("This booking link is invalid or expired");
    const transaction = await createAppointmentPaymentLink(appointment.businessId, appointment.id, paymentLinkSchema.parse(request.body).kind);
    reply.status(201).send({ id: transaction.id, url: transaction.checkoutUrl, amount: transaction.amount, currency: transaction.currency });
  });
}
