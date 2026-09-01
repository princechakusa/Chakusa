import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  cancelCustomerBooking,
  createCustomerBooking,
  customerBookingIcs,
  getBookingAvailability,
  getCustomerBooking,
  listBookableServices,
  listCustomerBookings,
  rescheduleCustomerBooking,
} from "../../lib/booking/customerBooking.js";

// PROGRAM 2 LOOP 3: authenticated customer booking + calendar. Delegates
// every scheduling decision to the existing appointment/availability
// services — see src/lib/booking/customerBooking.ts.

const slug = z.string().trim().min(1).max(200);
const dateTime = z.string().datetime({ offset: true });

export default async function customerBookingRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticateCustomer);

  fastify.get("/businesses/:slug/services", async (request) => {
    const { slug: s } = z.object({ slug }).parse(request.params);
    return listBookableServices(s, request.customer!.profileId);
  });

  fastify.get("/businesses/:slug/availability", async (request) => {
    const { slug: s } = z.object({ slug }).parse(request.params);
    const query = z.object({ serviceOfferingId: z.string().uuid(), from: dateTime, to: dateTime, memberId: z.string().uuid().optional() })
      .refine((value) => new Date(value.to) > new Date(value.from), { message: "to must be after from", path: ["to"] })
      .parse(request.query);
    return getBookingAvailability(s, query);
  });

  fastify.post("/", async (request, reply) => {
    const body = z.object({
      slug,
      serviceOfferingId: z.string().uuid(),
      assignedMemberId: z.string().uuid().optional(),
      startsAt: dateTime,
      notes: z.string().trim().max(1000).optional(),
    }).parse(request.body);
    reply.status(201).send(await createCustomerBooking(request.customer!.profileId, body));
  });

  fastify.get("/", async (request) => {
    const { scope } = z.object({ scope: z.enum(["upcoming", "past", "all"]).optional() }).parse(request.query);
    return listCustomerBookings(request.customer!.profileId, scope ?? "all");
  });

  fastify.get("/:id", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return getCustomerBooking(request.customer!.profileId, id);
  });

  fastify.patch("/:id/reschedule", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ startsAt: dateTime, assignedMemberId: z.string().uuid().optional() }).parse(request.body);
    return rescheduleCustomerBooking(request.customer!.profileId, id, body);
  });

  fastify.post("/:id/cancel", async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    return cancelCustomerBooking(request.customer!.profileId, id);
  });

  fastify.get("/:id/calendar.ics", async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const ics = await customerBookingIcs(request.customer!.profileId, id);
    reply.header("content-type", "text/calendar; charset=utf-8").header("content-disposition", 'attachment; filename="appointment.ics"').send(ics);
  });
}
