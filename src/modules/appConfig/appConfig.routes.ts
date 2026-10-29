import type { FastifyInstance } from "fastify";
import { getPublicAppConfig } from "./appConfig.service.js";
import { describePlans } from "../../lib/entitlements.js";

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

  // What each plan includes and its limits, straight from the entitlement
  // tables the API enforces. Public and identical for everyone.
  fastify.get("/plans", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (_request, reply) => {
    reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    if (!reply.getHeader("access-control-allow-origin")) reply.header("Access-Control-Allow-Origin", "*");
    const { pricing } = await getPublicAppConfig();
    reply.send({
      currency: pricing.currency,
      plans: describePlans().map((plan) => ({
        ...plan,
        referenceMonthlyPrice: plan.plan === "FREE" ? 0 : pricing.monthly[plan.plan],
        trialDays: plan.plan === "FREE" ? 0 : pricing.trialDays[plan.plan],
      })),
    });
  });
}
