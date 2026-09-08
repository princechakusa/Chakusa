import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCapability } from "../../lib/authorization.js";
import { assertFeatureAvailable, hasFeature } from "../../lib/entitlements.js";
import {
  getReceptionistSettings,
  receptionistGate,
  resolveBusinessHoursForReceptionist,
  updateReceptionistSettings,
} from "../../lib/ai/agent/receptionistSettings.js";
import { isCustomerAgentEnabled } from "../../lib/ai/agent/customerAgent.js";
import { resolveActivePolicy } from "../../lib/ai/policyEngine.js";

const patchSchema = z
  .object({
    enabled: z.boolean().optional(),
    smsEnabled: z.boolean().optional(),
    whatsappEnabled: z.boolean().optional(),
    mode: z.enum(["ALWAYS", "AFTER_HOURS_ONLY"]).optional(),
  })
  .refine(v => Object.keys(v).length > 0, { message: "No fields to update" });

/**
 * AI Receptionist #15 + After-hours #16 — the business control surface over
 * the existing AI Customer Agent engine. This module owns ONLY on/off,
 * per-channel toggles and the schedule mode; autonomy, tool authorization and
 * escalation stay with the Policy Engine (/ai/policies) and the agent runtime.
 * The "after hours" decision is deterministic server-side logic — never the
 * model's.
 */
export default async function aiReceptionistRoutes(fastify: FastifyInstance) {
  fastify.addHook("preHandler", fastify.authenticate);
  fastify.addHook("preHandler", fastify.requireBusiness);

  fastify.get("/", async (request, reply) => {
    requireCapability(request, "automation.manage");
    const [settings, platformEnabled, policy, hours] = await Promise.all([
      getReceptionistSettings(request.businessId!),
      isCustomerAgentEnabled(request.businessId!),
      resolveActivePolicy(request.businessId!),
      resolveBusinessHoursForReceptionist(request.businessId!),
    ]);
    const entitled = hasFeature(request.plan!, request.status!, "AI_RECEPTIONIST");
    // "Will the AI answer an SMS right now" — mirrors the inbound gate.
    const sample = await receptionistGate(request.businessId!, "sms", request.plan!, request.status!);

    reply.send({
      settings,
      hours: {
        resolved: hours.resolved,
        open: hours.open,
        reason: hours.reason,
        timezone: hours.timezone,
        localTime: hours.localTime,
        nextOpen: hours.nextOpen ? { label: hours.nextOpen.label, atIso: hours.nextOpen.atIso } : null,
      },
      status: {
        entitled,
        platformEnabled,
        policyMode: policy.mode,
        // Effective = master toggle + platform switch + entitlement (schedule
        // aside). currentlyEligible additionally applies the after-hours gate.
        effective: settings.enabled && platformEnabled && entitled,
        currentlyEligible: platformEnabled && sample.ok,
        ineligibleReason: sample.ok ? null : sample.reason,
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
