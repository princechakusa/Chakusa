import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCapability } from "../../lib/authorization.js";
import { assertFeatureAvailable, hasFeature } from "../../lib/entitlements.js";
import { getReceptionistSettings, updateReceptionistSettings } from "../../lib/ai/agent/receptionistSettings.js";
import { isCustomerAgentEnabled } from "../../lib/ai/agent/customerAgent.js";
import { resolveActivePolicy } from "../../lib/ai/policyEngine.js";

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    whatsappEnabled: z.boolean().optional(),
  })
  .refine(v => Object.keys(v).length > 0, { message: "No fields to update" });

/**
 * AI Receptionist #15 — the business control surface over the existing AI
 * Customer Agent engine. This module owns ONLY on/off + per-channel toggles
 * and status; autonomy, tool authorization and escalation stay with the
 * Policy Engine (/ai/policies) and the agent runtime.
 */
export default async function aiReceptionistRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/", async (request, reply) => {
    requireCapability(request, "automation.manage");
    const [settings, platformEnabled, policy] = await Promise.all([
      getReceptionistSettings(request.businessId!),
      isCustomerAgentEnabled(request.businessId!),
      resolveActivePolicy(request.businessId!),
    ]);
    reply.send({
      settings,
      status: {
        entitled: hasFeature(request.plan!, request.status!, "AI_RECEPTIONIST"),
        platformEnabled,
        policyMode: policy.mode,
        // Effective = will the AI actually answer inbound messages right now.
        effective: settings.enabled && platformEnabled && hasFeature(request.plan!, request.status!, "AI_RECEPTIONIST"),
      },
    });
  });

  fastify.patch("/", async (request, reply) => {
    requireCapability(request, "automation.manage");
    assertFeatureAvailable(request.plan!, request.status!, "AI_RECEPTIONIST");
    const input = patchSchema.parse(request.body);
    reply.send(await updateReceptionistSettings(request.businessId!, request.user.userId, input));
  });
}
