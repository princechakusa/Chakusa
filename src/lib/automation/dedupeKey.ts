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

/**
 * LEAD_FOLLOW_UP fires at most once per (rule, lead) ever — a single
 * "still interested?" nudge once a lead has sat too long, not a recurring
 * nag. If the owner wants to follow up again, the existing manual
 * "generate message" action on the lead is still available.
 */
export function buildLeadFollowUpDedupeKey(ruleId: string, leadId: string): string {
  return `${ruleId}:LEAD_FOLLOW_UP:${leadId}`;
}

/**
 * CUSTOMER_RETENTION fires at most once per (rule, customer) ever — a
 * single automated win-back attempt per customer, not a repeating
 * campaign. The business owner can always create another manual comeback
 * reminder (the existing Comeback screen) if they want to try again.
 */
export function buildCustomerRetentionDedupeKey(ruleId: string, customerId: string): string {
  return `${ruleId}:CUSTOMER_RETENTION:${customerId}`;
}
