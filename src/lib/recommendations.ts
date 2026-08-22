/**
 * Turns numbers already computed elsewhere (dashboard.service.ts,
 * businessHealth.ts, customerIntelligence.ts) into a short, ordered list of
 * things the owner can actually act on today. Every recommendation is
 * derived from real counts passed in — nothing here invents advice or
 * consults anything outside its input.
 *
 * Deliberately does NOT include a "Recovery Engine is inactive" style
 * recommendation: whether call detection/automation/push are actually
 * enabled is on-device state (see mobile/src/domain/recoveryEngineStatus.ts)
 * that is never reported to the backend, so this module has no honest way
 * to know it. That recommendation, if wanted, belongs on the mobile side
 * next to where recoveryEngineStatus() is already computed — adding a
 * server-side guess here would be exactly the "fake advice" this stage
 * was told never to produce.
 */
export type RecommendationSeverity = "info" | "attention";

export interface Recommendation {
  key: string;
  message: string;
  severity: RecommendationSeverity;
}

export interface RecommendationsInput {
  needingFollowUpCount: number;
  customersDueForReviewRequestCount: number;
  outstandingRevenue: number;
  customersDue: number;
  profileCompleteness: number;
}

export function generateRecommendations(input: RecommendationsInput): Recommendation[] {
  const recommendations: Recommendation[] = [];

  if (input.needingFollowUpCount > 0) {
    recommendations.push({
      key: "contact_customers",
      message: `Contact ${input.needingFollowUpCount} customer${input.needingFollowUpCount === 1 ? "" : "s"} waiting on a response.`,
      severity: "attention",
    });
  }

  if (input.customersDueForReviewRequestCount > 0) {
    recommendations.push({
      key: "request_reviews",
      message: `Request a review from ${input.customersDueForReviewRequestCount} recent customer${input.customersDueForReviewRequestCount === 1 ? "" : "s"}.`,
      severity: "info",
    });
  }

  if (input.outstandingRevenue > 0) {
    recommendations.push({
      key: "collect_outstanding_revenue",
      message: `You have outstanding revenue to collect from won jobs.`,
      severity: "attention",
    });
  }

  if (input.customersDue > 0) {
    recommendations.push({
      key: "bring_back_customers",
      message: `${input.customersDue} customer${input.customersDue === 1 ? " hasn't" : "s haven't"} returned recently — send a comeback reminder.`,
      severity: "info",
    });
  }

  if (input.profileCompleteness < 1) {
    recommendations.push({
      key: "complete_profile",
      message: "Finish your business profile so customers see a complete public page.",
      severity: "info",
    });
  }

  return recommendations;
}
