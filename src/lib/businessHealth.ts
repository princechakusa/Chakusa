/**
 * Simple, honest, explainable business health score — averages whichever
 * of these ratios currently have real data behind them (each already
 * computed elsewhere in dashboard.service.ts, so this adds zero new
 * queries): how often a missed-call lead gets followed up on at all
 * (contactRate), how often that turns into a won customer
 * (conversionRate), how often a review request actually becomes a review
 * (reviewsReceived / reviewRequestsSent), how often a comeback reminder
 * ends in a completed follow-through rather than sitting overdue
 * (comebackCompletedCount / (comebackCompletedCount + customersDue)), how
 * complete the business's own profile record is (profileCompleteness —
 * see businessProfileCompleteness.ts), and how much of the revenue from
 * won leads has actually been collected rather than sitting outstanding
 * (paymentCollectionRate).
 *
 * Deliberately not a predictive/ML score — every business owner should be
 * able to look at their own numbers and see exactly why this score is what
 * it is. That's what `factors` is for: every possible component is
 * reported, whether or not it had enough data to count toward the score,
 * so "why did my score change" always has a concrete answer. A brand-new
 * business with no activity yet gets `score: null`, not a low score — zero
 * leads is not the same thing as a badly-run business.
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
  /**
   * 0-1, from computeBusinessProfileCompleteness. Optional and additive:
   * omitting it (as every pre-existing caller/test does) reproduces the
   * exact score this function returned before profile completeness was
   * added as a component — it's simply left out of the average, not
   * treated as zero.
   */
  profileCompleteness?: number;
  /**
   * 0-1, or null when there isn't yet enough won-lead revenue to make the
   * ratio meaningful (mirrors the same "no data yet, not a bad score"
   * principle as every other gated component). Optional for the same
   * backward-compatibility reason as profileCompleteness.
   */
  paymentCollectionRate?: number | null;
}

export interface BusinessHealthFactor {
  key: "contactRate" | "conversionRate" | "reviewConversion" | "comebackCompletion" | "profileCompleteness" | "paymentCollectionRate";
  label: string;
  /** 0-100, or null when `included` is false (not enough data yet for this factor). */
  value: number | null;
  /** Whether this factor actually contributed to `score` below. */
  included: boolean;
}

export interface BusinessHealthScore {
  score: number | null;
  label: BusinessHealthLabel | null;
  factors: BusinessHealthFactor[];
}

function labelFor(score: number): BusinessHealthLabel {
  if (score >= 80) return "excellent";
  if (score >= 60) return "good";
  if (score >= 40) return "needs_attention";
  return "at_risk";
}

export function computeBusinessHealth(input: BusinessHealthInput): BusinessHealthScore {
  const hasLeadData = input.totalLeads > 0;
  const hasReviewData = input.reviewRequestsSent > 0;
  const comebackTotal = input.comebackCompletedCount + input.customersDue;
  const hasComebackData = comebackTotal > 0;
  const hasPaymentData = input.paymentCollectionRate != null;

  const factors: BusinessHealthFactor[] = [
    { key: "contactRate", label: "How often you follow up on a lead", value: hasLeadData ? input.contactRate * 100 : null, included: hasLeadData },
    { key: "conversionRate", label: "How often a lead becomes a customer", value: hasLeadData ? input.conversionRate * 100 : null, included: hasLeadData },
    {
      key: "reviewConversion",
      label: "How often a review request becomes a review",
      value: hasReviewData ? Math.min(100, (input.reviewsReceived / input.reviewRequestsSent) * 100) : null,
      included: hasReviewData,
    },
    {
      key: "comebackCompletion",
      label: "How often a customer comes back when reminded",
      value: hasComebackData ? (input.comebackCompletedCount / comebackTotal) * 100 : null,
      included: hasComebackData,
    },
    {
      key: "profileCompleteness",
      label: "How complete your business profile is",
      value: input.profileCompleteness != null ? input.profileCompleteness * 100 : null,
      included: input.profileCompleteness != null,
    },
    {
      key: "paymentCollectionRate",
      label: "How much of your won revenue has been collected",
      value: hasPaymentData ? (input.paymentCollectionRate as number) * 100 : null,
      included: hasPaymentData,
    },
  ];

  const includedValues = factors.filter((factor) => factor.included).map((factor) => factor.value as number);
  if (includedValues.length === 0) {
    return { score: null, label: null, factors };
  }

  const score = Math.round(includedValues.reduce((sum, value) => sum + value, 0) / includedValues.length);
  return { score, label: labelFor(score), factors };
}
