import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appointmentListSchema, appointmentPaymentSchema, bulkImportAppointmentsSchema, createAppointmentSchema, setAppointmentArrivalSchema, transitionAppointmentSchema, updateAppointmentSchema } from "./appointments.schemas.js";
import { bulkImportAppointments, clearAppointmentArrivalState, createAppointment, getAppointment, listAppointments, setAppointmentArrivalState, transitionAppointment, updateAppointment, updateAppointmentPayment } from "./appointments.service.js";
import { sendAppointmentArrivalMessage, sendAppointmentConfirmation, sendCustomerAppointmentMessage } from "./appointmentReminders.js";
import { accrueForCompletedBooking } from "../../lib/loyalty/accrual.js";
import { requireCapability } from "../../lib/authorization.js";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
const idParams = z.object({ id: z.string().uuid() });
// Advanced Team #12: OWNER/ADMIN/STAFF may all manage and operate
// appointments (capability matrix, src/lib/capabilities.ts). Reads stay open
// to any member.
export default async function appointmentRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);
  fastify.get("/", async (request, reply) => reply.send(await listAppointments(request.businessId!, appointmentListSchema.parse(request.query))));
  fastify.post("/", async (request, reply) => {
    requireCapability(request, "appointments.manage");
    const appointment = await createAppointment(request.businessId!, request.user.userId, createAppointmentSchema.parse(request.body));
    await sendAppointmentConfirmation(appointment.id).catch(error => request.log.error(error, "automatic appointment confirmation failed"));
    reply.status(201).send(appointment);
  });
  fastify.post("/bulk-import", async (request, reply) => {
    requireCapability(request, "appointments.manage");
    reply.status(201).send(await bulkImportAppointments(request.businessId!, request.user.userId, request.plan!, bulkImportAppointmentsSchema.parse(request.body)));
  });
  fastify.get("/:id", async (request, reply) => reply.send(await getAppointment(request.businessId!, idParams.parse(request.params).id)));
  fastify.patch("/:id", async (request, reply) => {
    requireCapability(request, "appointments.manage");
    const id = idParams.parse(request.params).id;
    const input = updateAppointmentSchema.parse(request.body);
    const scheduleChanged = input.startsAt !== undefined || input.endsAt !== undefined || input.assignedMemberId !== undefined;
    const appointment = await updateAppointment(request.businessId!, request.user.userId, id, input);
    if (scheduleChanged) {
      await prisma.appointment.update({ where: { id }, data: { rescheduleConfirmationSentAt: null, customerReminderSentAt: null, sameDayReminderSentAt: null } });
      await sendCustomerAppointmentMessage(id, "rescheduled").catch(error => request.log.error(error, "automatic reschedule confirmation failed"));
    }
    reply.send(appointment);
  });
  fastify.post("/:id/status", async (request, reply) => {
    requireCapability(request, "appointments.operate");
    const id = idParams.parse(request.params).id;
    const status = transitionAppointmentSchema.parse(request.body).status;
    const appointment = await transitionAppointment(request.businessId!, request.user.userId, id, status);
    if (status === "CANCELED") await sendCustomerAppointmentMessage(id, "canceled").catch(error => request.log.error(error, "automatic cancellation confirmation failed"));
    // PROGRAM 2 LOOP 5: a completed booking earns loyalty points. Best-effort
    // and idempotent — never blocks or fails the transition.
    if (status === "COMPLETED") await accrueForCompletedBooking(id).catch(error => request.log.error(error, "loyalty accrual failed"));
    reply.send(appointment);
  });
  fastify.patch("/:id/payment", async (request, reply) => {
    requireCapability(request, "appointments.operate");
    reply.send(await updateAppointmentPayment(request.businessId!, request.user.userId, idParams.parse(request.params).id, appointmentPaymentSchema.parse(request.body).paidAmount));
  });
  // Operations #10 — On My Way / Arrival. GPS-free: the team taps a status.
  fastify.post("/:id/arrival", async (request, reply) => {
    requireCapability(request, "appointments.operate");
    const id = idParams.parse(request.params).id;
    const input = setAppointmentArrivalSchema.parse(request.body);
    await setAppointmentArrivalState(request.businessId!, request.user.userId, id, input.state);
    if (input.notifyCustomer) await sendAppointmentArrivalMessage(id, input.state).catch(error => request.log.error(error, "appointment arrival notification failed"));
    reply.send(await getAppointment(request.businessId!, id));
  });
  fastify.delete("/:id/arrival", async (request, reply) => {
    requireCapability(request, "appointments.operate");
    reply.send(await clearAppointmentArrivalState(request.businessId!, request.user.userId, idParams.parse(request.params).id));
  });
  fastify.post("/:id/send-confirmation", async (request, reply) => {
    requireCapability(request, "appointments.operate");
    const id = idParams.parse(request.params).id;
    await getAppointment(request.businessId!, id);
    if (!await sendAppointmentConfirmation(id)) throw ApiError.conflict("Confirmation could not be sent. Check the plan, customer phone, opt-out status, or previous delivery.");
    reply.send(await getAppointment(request.businessId!, id));
  });
}
