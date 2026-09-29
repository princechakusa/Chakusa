import type { FastifyInstance } from "fastify";
import { requireCapability } from "../../lib/authorization.js";
import { listWeeklyOwnerReports } from "./weeklyReports.service.js";

// Weekly owner reports carry revenue and outstanding balances, so they need
// the same "financial.report.view" capability (OWNER/ADMIN) as other
// financial reporting. STAFF cannot read them.
export default async function weeklyReportRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);
  fastify.get("/", async (request, reply) => {
    requireCapability(request, "financial.report.view");
    reply.send(await listWeeklyOwnerReports(request.businessId!));
  });
}
