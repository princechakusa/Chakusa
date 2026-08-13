import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { isAutomationEntitled } from "../entitlements.js";
import { LEAD_SOURCE_MISSED_CALL } from "../leadSources.js";
import { createAutomationRun } from "../../modules/automation/automation.service.js";
import { buildLeadCreatedDedupeKey } from "./dedupeKey.js";
import type { Lead } from "@prisma/client";

/**
 * Called synchronously from leads.service.ts's createLead, immediately
 * after the lead exists — but this only ever *schedules* (creates a
 * PENDING AutomationRun row). It never sends anything and never blocks or
 * fails lead creation; every exit path below is either a silent "nothing
 * to do" or a caught-and-logged error, mirroring the exact discipline
 * notifyLeadCreated (src/lib/notifications/notificationTriggers.ts) already
 * uses for the same reason: secondary work must never break the primary
 * business action.
 *
 * Deliberately re-resolves plan+status from the database rather than
 * trusting any caller-supplied plan — createLead's own `plan` parameter is
 * only used for the Free lead-count limit and is not treated as
 * automation-authoritative here (see entitlements.ts's isAutomationEntitled
 * for why plan alone isn't enough: an EXPIRED PRO business must not have
 * automation scheduled just because Subscription.plan still reads "PRO").
 */
export async function scheduleMissedCallFollowUp(businessId: string, lead: Lead): Promise<void> {
  try {
    if (lead.source !== LEAD_SOURCE_MISSED_CALL) return;
    if (!lead.customerId) return; // nothing to eventually send to — no point scheduling.

    const subscription = await prisma.subscription.findUnique({
      where: { businessId },
      select: { plan: true, status: true },
    });
    if (!subscription || !isAutomationEntitled(subscription.plan, subscription.status)) return;

    const rule = await prisma.automationRule.findFirst({
      where: { businessId, triggerType: "LEAD_CREATED", enabled: true, channel: "SMS" },
    });
    if (!rule) return;

    const dedupeKey = buildLeadCreatedDedupeKey(rule.id, lead.id);
    const scheduledFor = new Date(Date.now() + rule.delaySeconds * 1000);

    await createAutomationRun(businessId, {
      automationRuleId: rule.id,
      customerId: lead.customerId,
      leadId: lead.id,
      dedupeKey,
      scheduledFor,
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === "CONFLICT") {
      // A run for this exact (rule, lead) already exists — the unique
      // constraint on (businessId, dedupeKey) is what actually prevents
      // the duplicate; this is the expected, idempotent outcome of the
      // same event being processed more than once, not a failure.
      return;
    }
    console.error("[automation] failed to schedule missed-call follow-up", error);
  }
}
