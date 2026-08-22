/**
 * Shapes/derives customer-level business insight from data
 * dashboard.service.ts already queries (or adds one small SQL aggregate
 * for) — kept pure and separate from the querying itself so every ratio
 * here is deterministic and unit-testable without a database, matching the
 * same split businessHealth.ts already establishes.
 *
 * "Repeat customer rate" is defined as: of customers who have ever won at
 * least one job, what fraction won a second one. This is the standard,
 * unambiguous definition for a service business — it doesn't get muddied
 * by manually-entered duplicate leads or reminders that were merely
 * scheduled but never completed.
 */
export interface CustomerWonLeadCount {
  customerId: string;
  wonLeadCount: number;
  lifetimeValue: number;
}

export interface CustomerNeedingFollowUp {
  customerId: string;
  customerName: string | null;
  reason: "new_lead" | "comeback_due";
}

export interface CustomerIntelligenceInput {
  totalCustomers: number;
  newCustomersThisPeriod: number;
  wonLeadCountsByCustomer: CustomerWonLeadCount[];
  /** Sum of (wonAt - createdAt) in days across won leads with both timestamps, and how many leads that average is over. */
  recoveryDaysTotal: number;
  recoveryDaysSampleSize: number;
  needingFollowUp: CustomerNeedingFollowUp[];
  needingFollowUpTotalCount: number;
}

export interface CustomerIntelligenceSummary {
  totalCustomers: number;
  newCustomersThisPeriod: number;
  customersWithWonLead: number;
  returningCustomers: number;
  /** null when no customer has won a lead yet — nothing to compute a rate from. */
  repeatCustomerRate: number | null;
  /** null when no customer has won a lead yet. */
  averageLifetimeValue: number | null;
  /** null when no won lead has both a creation and a won timestamp yet. */
  averageRecoveryDays: number | null;
  needingFollowUp: CustomerNeedingFollowUp[];
  needingFollowUpTotalCount: number;
  topCustomersByValue: { customerId: string; lifetimeValue: number }[];
}

const TOP_CUSTOMERS_LIMIT = 5;

export function computeCustomerIntelligence(input: CustomerIntelligenceInput): CustomerIntelligenceSummary {
  const customersWithWonLead = input.wonLeadCountsByCustomer.length;
  const returningCustomers = input.wonLeadCountsByCustomer.filter((c) => c.wonLeadCount >= 2).length;

  const repeatCustomerRate = customersWithWonLead > 0 ? returningCustomers / customersWithWonLead : null;

  const totalLifetimeValue = input.wonLeadCountsByCustomer.reduce((sum, c) => sum + c.lifetimeValue, 0);
  const averageLifetimeValue = customersWithWonLead > 0 ? totalLifetimeValue / customersWithWonLead : null;

  const averageRecoveryDays = input.recoveryDaysSampleSize > 0 ? input.recoveryDaysTotal / input.recoveryDaysSampleSize : null;

  const topCustomersByValue = [...input.wonLeadCountsByCustomer]
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue)
    .slice(0, TOP_CUSTOMERS_LIMIT)
    .map((c) => ({ customerId: c.customerId, lifetimeValue: c.lifetimeValue }));

  return {
    totalCustomers: input.totalCustomers,
    newCustomersThisPeriod: input.newCustomersThisPeriod,
    customersWithWonLead,
    returningCustomers,
    repeatCustomerRate,
    averageLifetimeValue,
    averageRecoveryDays,
    needingFollowUp: input.needingFollowUp,
    needingFollowUpTotalCount: input.needingFollowUpTotalCount,
    topCustomersByValue,
  };
}
