import type { CustomerLifecycleStage } from "./customerLifecycle.js";

/**
 * Part 4's "Business Assistant integration" — a single, customer-scoped
 * highlight shown inline in the Conversation & Communication Center,
 * following the exact same shape businessCoaching.ts's CoachingInsight
 * already established (evidence, then a suggested action) so the UI
 * treatment is identical. This is a deliberately separate, additive module
 * rather than a new generator inside businessCoaching.ts: that engine is a
 * completed, frozen system, and its generators are business-wide (one
 * insight per business); this is customer-scoped (at most one per
 * customer, computed from data getCustomerProfile already fetched — no new
 * queries). `quickAction` maps directly to a Part 3 quick action the
 * calling screen already implements, not a new workflow.
 *
 * Only ever returns one highlight, in priority order (outstanding payment
 * beats a dormant win-back opportunity beats a review-request nudge) — one
 * clear "what to do next," not a list, matching the "avoid clutter"
 * instruction.
 */
export type CustomerCoachingQuickAction = "recordPayment" | "createReminder" | "requestReview";

export interface CustomerCoachingHighlight {
  title: string;
  evidence: string[];
  recommendedAction: string;
  quickAction: CustomerCoachingQuickAction;
}

export interface CustomerCoachingHighlightInput {
  customerName: string;
  lifecycleStage: CustomerLifecycleStage;
  daysSinceLastActivity: number | null;
  hasOutstandingPayment: boolean;
  outstandingAmount: string | null;
  hasDueReminder: boolean;
  /** True if a ReviewRequest has ever been created for this customer, at any status — once asked, never re-suggested regardless of outcome. */
  hasAnyReviewRequest: boolean;
  wonLeadCount: number;
}

export function generateCustomerCoachingHighlight(input: CustomerCoachingHighlightInput): CustomerCoachingHighlight | null {
  if (input.hasOutstandingPayment) {
    return {
      title: `${input.customerName} has an outstanding payment`,
      evidence: input.outstandingAmount ? [`${input.outstandingAmount} outstanding`] : ["Payment not yet recorded as paid"],
      recommendedAction: "Record the payment once it's collected",
      quickAction: "recordPayment",
    };
  }

  if (input.lifecycleStage === "dormant" && !input.hasDueReminder) {
    return {
      title: `${input.customerName} hasn't been back in a while`,
      evidence: input.daysSinceLastActivity != null ? [`${input.daysSinceLastActivity} days since last activity`] : ["No recent activity"],
      recommendedAction: "Set a comeback reminder to win them back",
      quickAction: "createReminder",
    };
  }

  if (input.wonLeadCount > 0 && !input.hasAnyReviewRequest) {
    return {
      title: `Ask ${input.customerName} for a review`,
      evidence: [`${input.wonLeadCount} completed job${input.wonLeadCount === 1 ? "" : "s"}`],
      recommendedAction: "Request a review while the experience is fresh",
      quickAction: "requestReview",
    };
  }

  return null;
}
