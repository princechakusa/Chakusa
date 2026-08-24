import type { FastifyInstance } from "fastify";
import { listWeeklyOwnerReports } from "./weeklyReports.service.js";
export default async function weeklyReportRoutes(fastify: FastifyInstance) { fastify.addHook("preHandler", fastify.authenticate); fastify.addHook("preHandler", fastify.requireBusiness); fastify.get("/", async (request, reply) => reply.send(await listWeeklyOwnerReports(request.businessId!))); }
