/**
 * Deterministic AutomationRun.dedupeKey builders — one per trigger type
 * this phase supports. Deliberately NOT a random value (no randomUUID):
 * the same (rule, triggering entity) pair must always produce the exact
 * same key, so that createAutomationRun's unique constraint on
 * (businessId, dedupeKey) — not this function — is what actually prevents
 * two runs for the same event. This function only needs to be stable, not
 * secret or unguessable.
 */
export function buildLeadCreatedDedupeKey(ruleId: string, leadId: string): string {
  return `${ruleId}:LEAD_CREATED:${leadId}`;
}
