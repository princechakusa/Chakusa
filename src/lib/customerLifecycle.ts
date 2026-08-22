/**
 * Classifies a customer's relationship with the business into one lifecycle
 * stage — pure and deterministic, exactly like businessHealth.ts and
 * customerIntelligence.ts: this never queries the database itself, it only
 * shapes numbers a caller already has (won-lead count, last activity,
 * lifetime value). Every stage is derived entirely from real Lead history;
 * nothing here is estimated or predicted.
 *
 * Stage precedence (checked top to bottom, first match wins):
 *   1. lost           — every lead this customer has ever had is "lost",
 *                        and none has ever been won.
 *   2. new_lead        — has a lead, none contacted/won/lost yet.
 *   3. contacted       — has been contacted or booked, never won.
 *   4. dormant         — has won at least once, but hasn't been seen
 *                        (any new lead) in `dormantAfterDays` days.
 *   5. vip             — lifetime value at or above `vipLifetimeValueThreshold`.
 *   6. loyal           — `loyalWonLeadThreshold` or more won leads.
 *   7. returning       — 2+ won leads (but below the loyal threshold).
 *   8. first_customer  — exactly 1 won lead.
 *
 * dormant is checked before vip/loyal/returning/first_customer so a
 * high-value customer who has gone quiet is still flagged as needing
 * win-back attention, not hidden behind their historical value tier.
 */
export type CustomerLifecycleStage =
  | "lost"
  | "new_lead"
  | "contacted"
  | "dormant"
  | "vip"
  | "loyal"
  | "returning"
  | "first_customer";

export interface CustomerLifecycleInput {
  /** Number of leads with status "lost". */
  lostLeadCount: number;
  /** Number of leads with status "contacted" or "booked". */
  contactedOrBookedLeadCount: number;
  /** Number of leads with status "new". */
  newLeadCount: number;
  /** Number of leads with status "won". */
  wonLeadCount: number;
  /** Sum of estimatedValue across won leads. */
  lifetimeValue: number;
  /** Days since this customer's most recent lead of any status — null if they have never had a lead at all. */
  daysSinceLastActivity: number | null;
}

export interface CustomerLifecycleThresholds {
  /** A customer who has won before but gone quiet this long is "dormant". Default mirrors Business.reminderDays' own default (42). */
  dormantAfterDays: number;
  /** Won-lead count at or above this is "loyal" rather than merely "returning". */
  loyalWonLeadThreshold: number;
  /** Lifetime value at or above this is "vip", checked ahead of the loyal/returning tiers. */
  vipLifetimeValueThreshold: number;
}

export const DEFAULT_LIFECYCLE_THRESHOLDS: CustomerLifecycleThresholds = {
  dormantAfterDays: 42,
  loyalWonLeadThreshold: 3,
  vipLifetimeValueThreshold: 1000,
};

export function classifyCustomerLifecycleStage(
  input: CustomerLifecycleInput,
  thresholds: CustomerLifecycleThresholds = DEFAULT_LIFECYCLE_THRESHOLDS,
): CustomerLifecycleStage {
  const totalLeads = input.lostLeadCount + input.contactedOrBookedLeadCount + input.newLeadCount + input.wonLeadCount;

  if (input.wonLeadCount === 0 && input.lostLeadCount > 0 && totalLeads === input.lostLeadCount) {
    return "lost";
  }
  if (input.wonLeadCount === 0 && input.contactedOrBookedLeadCount === 0 && input.newLeadCount > 0) {
    return "new_lead";
  }
  if (input.wonLeadCount === 0 && input.contactedOrBookedLeadCount > 0) {
    return "contacted";
  }

  // Everything below this point requires at least one won lead — a
  // customer with zero wins can only ever be lost/new_lead/contacted above.
  if (input.wonLeadCount === 0) {
    return "new_lead";
  }

  if (input.daysSinceLastActivity != null && input.daysSinceLastActivity >= thresholds.dormantAfterDays) {
    return "dormant";
  }
  if (input.lifetimeValue >= thresholds.vipLifetimeValueThreshold) {
    return "vip";
  }
  if (input.wonLeadCount >= thresholds.loyalWonLeadThreshold) {
    return "loyal";
  }
  if (input.wonLeadCount >= 2) {
    return "returning";
  }
  return "first_customer";
}

export interface LifecycleStageCounts {
  lost: number;
  new_lead: number;
  contacted: number;
  dormant: number;
  vip: number;
  loyal: number;
  returning: number;
  first_customer: number;
}

/** Tallies a batch of already-classified stages — used to build the Dashboard/Insights breakdown and the Business Assistant's dormant-customer insight without re-deriving anything. */
export function tallyLifecycleStages(stages: CustomerLifecycleStage[]): LifecycleStageCounts {
  const counts: LifecycleStageCounts = { lost: 0, new_lead: 0, contacted: 0, dormant: 0, vip: 0, loyal: 0, returning: 0, first_customer: 0 };
  for (const stage of stages) {
    counts[stage] += 1;
  }
  return counts;
}
