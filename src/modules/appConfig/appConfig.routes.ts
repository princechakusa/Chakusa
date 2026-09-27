import type { FastifyInstance } from "fastify";
import { getPublicAppConfig } from "./appConfig.service.js";

// Public, unauthenticated runtime configuration for the mobile/web apps.
// No secrets, nothing tenant-specific; see appConfig.service.ts. Short
// shared cache so an admin change reaches apps within about a minute.
export default async function appConfigRoutes(fastify: FastifyInstance) {
  fastify.get("/app-config", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    // Public and credential-free, so any site (e.g. the marketing website)
    // may read it, independent of the API's credentialed CORS allowlist.
    if (!reply.getHeader("access-control-allow-origin")) reply.header("Access-Control-Allow-Origin", "*");
    reply.send(await getPublicAppConfig());
  });
}
