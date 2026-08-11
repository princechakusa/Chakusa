import type { FastifyInstance } from "fastify";
import { createReminderSchema, updateReminderSchema } from "./reminders.schemas.js";
import {
  listReminders,
  createReminder,
  getReminder,
  updateReminder,
  generateReminderMessage,
  markReminderSent,
  markReminderCompleted,
  dismissReminder,
} from "./reminders.service.js";

export default async function reminderRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/", async (request, reply) => {
    reply.send(await listReminders(request.businessId!));
  });

  fastify.post("/", async (request, reply) => {
    const input = createReminderSchema.parse(request.body);
    const reminder = await createReminder(request.businessId!, request.user.userId, input);
    reply.status(201).send(reminder);
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    reply.send(await getReminder(request.businessId!, request.params.id));
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const input = updateReminderSchema.parse(request.body);
    reply.send(await updateReminder(request.businessId!, request.params.id, input));
  });

  fastify.post<{ Params: { id: string } }>("/:id/generate-message", async (request, reply) => {
    reply.send(await generateReminderMessage(request.businessId!, request.params.id));
  });

  fastify.post<{ Params: { id: string } }>("/:id/mark-sent", async (request, reply) => {
    reply.send(await markReminderSent(request.businessId!, request.user.userId, request.params.id));
  });

  fastify.post<{ Params: { id: string } }>("/:id/mark-completed", async (request, reply) => {
    reply.send(
      await markReminderCompleted(request.businessId!, request.user.userId, request.params.id),
    );
  });

  fastify.post<{ Params: { id: string } }>("/:id/dismiss", async (request, reply) => {
    reply.send(await dismissReminder(request.businessId!, request.user.userId, request.params.id));
  });
}
