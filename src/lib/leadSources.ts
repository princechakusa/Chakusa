export const LEAD_SOURCE_MISSED_CALL = "missed_call";
export const LEAD_SOURCE_PUBLIC_PROFILE = "public_profile";

/**
 * Lead sources whose creation should trigger LEAD_CREATED automation. This
 * is the single place that decision is made — scheduler.ts and executor.ts
 * both call `supportsLeadCreatedAutomation` instead of each independently
 * comparing `lead.source` to a magic string, so adding a future recovery
 * source (WhatsApp, etc.) to automation is a one-line addition here, not a
 * change to the scheduling/execution logic itself. Deliberately not every
 * lead source: a manually-entered "referral" or "walk-in" lead firing a
 * message written for the wrong context would be a real product bug, not
 * just an implementation detail — automation eligibility is a property of
 * the source, not of lead creation in general.
 *
 * PUBLIC_PROFILE was deliberately excluded when the public profile feature
 * shipped, specifically because the only template that existed at the time
 * was written for missed calls ("sorry we missed your call" makes no sense
 * for a customer who just proactively reached out). It's included now that
 * messageRendering.ts's TEMPLATE_TYPE_BY_LEAD_SOURCE gives it its own
 * "public_profile_inquiry" wording — the two changes are paired and must
 * not be separated (adding a source here without a matching template entry
 * would silently fall back to the missed-call copy, recreating the exact
 * bug this comment originally warned against).
 */
const LEAD_CREATED_AUTOMATION_SOURCES: ReadonlySet<string> = new Set([LEAD_SOURCE_MISSED_CALL, LEAD_SOURCE_PUBLIC_PROFILE]);

export function supportsLeadCreatedAutomation(source: string | null | undefined): boolean {
  return source != null && LEAD_CREATED_AUTOMATION_SOURCES.has(source);
}
