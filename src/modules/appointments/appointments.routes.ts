import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { appointmentListSchema, appointmentPaymentSchema, bulkImportAppointmentsSchema, createAppointmentSchema, transitionAppointmentSchema, updateAppointmentSchema } from "./appointments.schemas.js";
import { bulkImportAppointments, createAppointment, getAppointment, listAppointments, transitionAppointment, updateAppointment, updateAppointmentPayment } from "./appointments.service.js";
import { sendAppointmentConfirmation, sendCustomerAppointmentMessage } from "./appointmentReminders.js";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
const idParams = z.object({ id: z.string().uuid() });
export default async function appointmentRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);
  fastify.get("/", async (request, reply) => reply.send(await listAppointments(request.businessId!, appointmentListSchema.parse(request.query))));
  fastify.post("/", async (request, reply) => {
    const appointment = await createAppointment(request.businessId!, request.user.userId, createAppointmentSchema.parse(request.body));
    await sendAppointmentConfirmation(appointment.id).catch(error => request.log.error(error, "automatic appointment confirmation failed"));
    reply.status(201).send(appointment);
  });
  fastify.post("/bulk-import", async (request, reply) => reply.status(201).send(await bulkImportAppointments(request.businessId!, request.user.userId, request.plan!, bulkImportAppointmentsSchema.parse(request.body))));
  fastify.get("/:id", async (request, reply) => reply.send(await getAppointment(request.businessId!, idParams.parse(request.params).id)));
  fastify.patch("/:id", async (request, reply) => {
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
    const id = idParams.parse(request.params).id;
    const status = transitionAppointmentSchema.parse(request.body).status;
    const appointment = await transitionAppointment(request.businessId!, request.user.userId, id, status);
    if (status === "CANCELED") await sendCustomerAppointmentMessage(id, "canceled").catch(error => request.log.error(error, "automatic cancellation confirmation failed"));
    reply.send(appointment);
  });
  fastify.patch("/:id/payment", async (request, reply) => reply.send(await updateAppointmentPayment(request.businessId!, request.user.userId, idParams.parse(request.params).id, appointmentPaymentSchema.parse(request.body).paidAmount)));
  fastify.post("/:id/send-confirmation", async (request, reply) => {
    const id = idParams.parse(request.params).id;
    await getAppointment(request.businessId!, id);
    if (!await sendAppointmentConfirmation(id)) throw ApiError.conflict("Confirmation could not be sent. Check the plan, customer phone, opt-out status, or previous delivery.");
    reply.send(await getAppointment(request.businessId!, id));
  });
}
