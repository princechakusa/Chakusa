import type { CustomerLifecycleStage } from "./customerLifecycle.js";

/**
 * Part 2's "communication status" tags — a small, deterministic summary of
 * where things currently stand with one customer, derived entirely from
 * data the caller already has (never estimated). Multiple statuses can
 * apply at once (e.g. a customer can be both "dormant" and have a
 * "payment_outstanding" from their last job).
 */
export type CommunicationStatus =
  | "waiting_for_follow_up"
  | "waiting_for_review"
  | "reminder_scheduled"
  | "payment_outstanding"
  | "customer_returned"
  | "dormant";

export interface CommunicationStatusInput {
  /** True if any of this customer's leads is still in a non-terminal status (new/contacted/booked). */
  hasOpenLead: boolean;
  /** True if any review request for this customer is still pending/sent/opened (not yet reviewed). */
  hasPendingReviewRequest: boolean;
  /** True if any reminder for this customer is status="due" and its dueDate has passed. */
  hasDueReminder: boolean;
  /** True if any won lead for this customer has paymentStatus != "paid". */
  hasOutstandingPayment: boolean;
  lifecycleStage: CustomerLifecycleStage;
}

const RETURNED_STAGES: readonly CustomerLifecycleStage[] = ["returning", "loyal", "vip"];

export function deriveCommunicationStatuses(input: CommunicationStatusInput): CommunicationStatus[] {
  const statuses: CommunicationStatus[] = [];

  if (input.hasOpenLead) statuses.push("waiting_for_follow_up");
  if (input.hasPendingReviewRequest) statuses.push("waiting_for_review");
  if (input.hasDueReminder) statuses.push("reminder_scheduled");
  if (input.hasOutstandingPayment) statuses.push("payment_outstanding");

  // dormant/returned are mutually exclusive descriptions of the same
  // lifecycle stage — never both at once, mirroring customerLifecycle.ts's
  // own precedence (dormant is checked ahead of the value tiers there too).
  if (input.lifecycleStage === "dormant") statuses.push("dormant");
  else if (RETURNED_STAGES.includes(input.lifecycleStage)) statuses.push("customer_returned");

  return statuses;
}
