export const LEAD_SOURCE_MISSED_CALL = "missed_call";
export const LEAD_SOURCE_PUBLIC_PROFILE = "public_profile";

/**
 * Lead sources whose creation should trigger LEAD_CREATED automation
 * (currently just the missed-call SMS follow-up). This is the single place
 * that decision is made — scheduler.ts and executor.ts both call
 * `supportsLeadCreatedAutomation` instead of each independently comparing
 * `lead.source` to a magic string, so adding a future recovery source
 * (web form, WhatsApp, etc.) to automation is a one-line addition here, not
 * a change to the scheduling/execution logic itself. Deliberately not every
 * lead source: a manually-entered "referral" or "walk-in" lead firing a
 * message written as "sorry we missed your call" would be a real product
 * bug, not just an implementation detail — automation eligibility is a
 * property of the source, not of lead creation in general.
 */
const LEAD_CREATED_AUTOMATION_SOURCES: ReadonlySet<string> = new Set([LEAD_SOURCE_MISSED_CALL]);

export function supportsLeadCreatedAutomation(source: string | null | undefined): boolean {
  return source != null && LEAD_CREATED_AUTOMATION_SOURCES.has(source);
}
