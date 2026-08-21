/**
 * Simple, honest, explainable business health score — averages whichever
 * of these ratios currently have real data behind them (each already
 * computed elsewhere in dashboard.service.ts, so this adds zero new
 * queries): how often a missed-call lead gets followed up on at all
 * (contactRate), how often that turns into a won customer
 * (conversionRate), how often a review request actually becomes a review
 * (reviewsReceived / reviewRequestsSent), and how often a comeback
 * reminder ends in a completed follow-through rather than sitting overdue
 * (comebackCompletedCount / (comebackCompletedCount + customersDue)).
 *
 * Deliberately not a predictive/ML score — every business owner should be
 * able to look at their own numbers and see exactly why this score is what
 * it is. A brand-new business with no activity yet gets `null`, not a low
 * score — zero leads is not the same thing as a badly-run business.
 */
export type BusinessHealthLabel = "excellent" | "good" | "needs_attention" | "at_risk";

export interface BusinessHealthInput {
  totalLeads: number;
  contactRate: number;
  conversionRate: number;
  reviewRequestsSent: number;
  reviewsReceived: number;
  comebackCompletedCount: number;
  customersDue: number;
}

export interface BusinessHealthScore {
  score: number | null;
  label: BusinessHealthLabel | null;
}

function labelFor(score: number): BusinessHealthLabel {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "needs_attention";
  return "at_risk";
}

export function computeBusinessHealth(input: BusinessHealthInput): BusinessHealthScore {
  const components: number[] = [];

  if (input.totalLeads > 0) {
    components.push(input.contactRate * 100);
    components.push(input.conversionRate * 100);
  }
  if (input.reviewRequestsSent > 0) {
    components.push(Math.min(100, (input.reviewsReceived / input.reviewRequestsSent) * 100));
  }
  const comebackTotal = input.comebackCompletedCount + input.customersDue;
  if (comebackTotal > 0) {
    components.push((input.comebackCompletedCount / comebackTotal) * 100);
  }

  if (components.length === 0) {
    return { score: null, label: null };
  }

  const score = Math.round(components.reduce((sum, value) => sum + value, 0) / components.length);
  return { score, label: labelFor(score) };
}
