import type { FastifyInstance } from "fastify";
import { registerDeviceSchema } from "./devices.schemas.js";
import { registerDevice, removeDevice } from "./devices.service.js";

export default async function deviceRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);

  fastify.post("/", async (request, reply) => {
    const input = registerDeviceSchema.parse(request.body);
    const device = await registerDevice(request.user.userId, input);
    reply.status(201).send(device);
  });

  fastify.delete<{ Params: { token: string } }>("/:token", async (request, reply) => {
    await removeDevice(request.user.userId, request.params.token);
    reply.status(204).send();
  });
}
