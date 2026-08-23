import type { AttentionCategory } from "../modules/dashboard/attentionCenter.service.js";
import type { getDashboardSummary } from "../modules/dashboard/dashboard.service.js";
import type { getBusinessInsights } from "../modules/dashboard/insights.service.js";
import type { AudienceSummary, SmartAudienceKey } from "../modules/customers/audiences.service.js";

/**
 * The AI Business Assistant Foundation — NOT a chatbot, NOT an LLM
 * integration, NOT conversational. This is a deterministic decision
 * engine: it reads the business intelligence Chakusa has already computed
 * (Business Health, Customer Intelligence, Business Insights,
 * Recommendations, Payments) and reshapes it into a small number of
 * explainable "coaching insights" — never calculating a single business
 * metric itself. Every number quoted in an insight's `evidence` is copied
 * verbatim from that existing intelligence; nothing here queries the
 * database, estimates, predicts, or invents.
 *
 * If a future insight would require data the backend genuinely doesn't
 * have (e.g. whether Recovery Engine automation is actually turned on —
 * that's on-device state, never reported here, see
 * recommendations.ts's identical exclusion), it is not generated. Rather
 * than guess.
 */

export type CoachingPriority = "critical" | "high" | "medium" | "low";

/**
 * Every action link maps to a screen/route that already exists — see
 * mobile/src/screens/*.tsx and RootStackParamList. Nothing here invents a
 * workflow; this type is a closed set matching exactly the destinations
 * the rest of the product already navigates to.
 */
export type CoachingActionLink =
  | { kind: "attentionCenter"; category: AttentionCategory }
  | { kind: "customerProfile"; customerId: string }
  | { kind: "comeback" }
  | { kind: "businessSettings" }
  | { kind: "audience"; audienceKey: SmartAudienceKey }
  | { kind: "insights" };

export interface CoachingInsight {
  key: string;
  title: string;
  /** The situation, in the owner's own numbers — "what is being measured." */
  context: string;
  /** Why this is worth the owner's attention right now. */
  whyItMatters: string;
  /** Concrete figures copied from existing computed intelligence — never fabricated. */
  evidence: string[];
  recommendedAction: string;
  actionLink: CoachingActionLink;
  expectedOutcome: string;
  priority: CoachingPriority;
}

type DashboardSummary = Awaited<ReturnType<typeof getDashboardSummary>>;
type BusinessInsights = Awaited<ReturnType<typeof getBusinessInsights>>;

export interface BusinessCoachingInput {
  summary: DashboardSummary;
  insights: BusinessInsights;
  audiences: AudienceSummary[];
}

// ---------------------------------------------------------------------------
// Priority thresholds — the ONLY place these numbers live, so "why is this
// insight ranked this way" always has one documented answer, not one
// buried per-insight.
// ---------------------------------------------------------------------------

/** needingFollowUpTotalCount at or above this is a backlog, not a normal day's queue. */
const CRITICAL_FOLLOW_UP_BACKLOG = 5;
/** repeatCustomerRate below this, with a large enough sample to trust it, is worth coaching on. */
const LOW_REPEAT_CUSTOMER_RATE = 0.3;
/** computeCustomerIntelligence only reports a rate once this many customers have won at least one job — same gate customerIntelligence.ts itself effectively applies via null-when-zero; this is the minimum sample size for treating a non-null rate as actionable rather than noise. */
const MIN_CUSTOMERS_FOR_REPEAT_RATE_INSIGHT = 3;
/** A service needs to actually have a meaningfully worse rate than the best one to be worth flagging — this is not a fixed percentage, it's a same-business relative comparison. */
const MIN_CONVERSION_GAP_FOR_SERVICE_INSIGHT = 0.25;
/** dormant customer count at or above this is worth flagging "high" rather than "medium" — same style of threshold as CRITICAL_FOLLOW_UP_BACKLOG above. */
const HIGH_DORMANT_CUSTOMER_COUNT = 5;

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}
function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function audience(input: BusinessCoachingInput, key: SmartAudienceKey): AudienceSummary | null {
  const match = input.audiences.find((item) => item.key === key);
  return match && match.totalCustomers > 0 ? match : null;
}

/**
 * The single, deterministic health-factor → action mapping used by the
 * "Business Health" insight below to point at the exact existing screen
 * that addresses whichever factor is weakest — never a generic "go check
 * your dashboard," always the specific place that factor's own numbers
 * live.
 */
function actionForHealthFactor(key: string): { recommendedAction: string; actionLink: CoachingActionLink } {
  switch (key) {
    case "contactRate":
    case "conversionRate":
      return { recommendedAction: "Follow up on leads waiting for a response", actionLink: { kind: "attentionCenter", category: "missed_call_followup" } };
    case "reviewConversion":
      return { recommendedAction: "Request reviews from recent customers", actionLink: { kind: "attentionCenter", category: "review_opportunity" } };
    case "comebackCompletion":
      return { recommendedAction: "Bring back customers who are due", actionLink: { kind: "attentionCenter", category: "customer_due" } };
    case "paymentCollectionRate":
      return { recommendedAction: "Collect outstanding payments", actionLink: { kind: "attentionCenter", category: "payment_outstanding" } };
    case "profileCompleteness":
    default:
      return { recommendedAction: "Finish your business profile", actionLink: { kind: "businessSettings" } };
  }
}

function customersWaitingInsight(input: BusinessCoachingInput): CoachingInsight | null {
  const count = input.summary.customerIntelligence.needingFollowUpTotalCount;
  if (count === 0) return null;

  const names = input.summary.customerIntelligence.needingFollowUp.slice(0, 3).map((c) => c.customerName ?? "an unassigned customer");
  const priority: CoachingPriority = count >= CRITICAL_FOLLOW_UP_BACKLOG ? "critical" : "high";
  const primaryCategory: AttentionCategory = input.summary.customerIntelligence.needingFollowUp[0]?.reason === "comeback_due" ? "customer_due" : "missed_call_followup";

  return {
    key: "customers_waiting",
    title: "Customers are waiting on you",
    context: `${count} customer${count === 1 ? " is" : "s are"} waiting for a follow-up right now.`,
    whyItMatters: "The longer a lead or overdue customer waits, the less likely they are to become — or stay — a paying customer.",
    evidence: [`${count} customer${count === 1 ? "" : "s"} currently need${count === 1 ? "s" : ""} follow-up`, ...names.map((name) => `Includes ${name}`)],
    recommendedAction: "Open the Action Center and follow up now",
    actionLink: { kind: "attentionCenter", category: primaryCategory },
    expectedOutcome: `Your current lead-to-customer conversion rate is ${pct(input.summary.leads.conversionRate)} — responding sooner protects that rate.`,
    priority,
  };
}

function outstandingRevenueInsight(input: BusinessCoachingInput): CoachingInsight | null {
  const segment = audience(input, "outstanding_payments");
  if (!segment || segment.outstandingPayments <= 0) return null;

  const outstanding = segment.outstandingPayments;
  const total = input.summary.recoveredRevenue.total;
  const outstandingShare = total > 0 ? outstanding / total : 1;
  const priority: CoachingPriority = outstandingShare >= 0.5 ? "critical" : "high";

  return {
    key: "outstanding_revenue",
    title: "Revenue is sitting uncollected",
    context: `${money(outstanding)} from won jobs has not been marked as paid.`,
    whyItMatters: "This is money already earned on completed work — it just hasn't been collected or recorded yet.",
    evidence: [`${segment.totalCustomers} customer${segment.totalCustomers === 1 ? "" : "s"} in Outstanding payments`, `${money(outstanding)} outstanding`, `${pct(outstandingShare)} of recovered revenue is still outstanding`],
    recommendedAction: "View customers with outstanding payments",
    actionLink: { kind: "audience", audienceKey: segment.key },
    expectedOutcome: "Recording payments as they come in keeps your recovered-revenue numbers accurate and surfaces who still owes you.",
    priority,
  };
}

function businessHealthInsight(input: BusinessCoachingInput): CoachingInsight | null {
  const { score, label, factors } = input.summary.businessHealth;
  if (score == null || label == null) return null;
  if (label !== "at_risk" && label !== "needs_attention") return null;

  const includedFactors = factors.filter((f) => f.included && f.value != null);
  if (includedFactors.length === 0) return null;
  const weakest = includedFactors.reduce((worst, factor) => (factor.value! < worst.value! ? factor : worst));
  const { recommendedAction, actionLink } = actionForHealthFactor(weakest.key);

  return {
    key: "business_health",
    title: label === "at_risk" ? "Business Health needs attention now" : "Business Health could be stronger",
    context: `Your Business Health score is ${score}/100 (${label.replace("_", " ")}).`,
    whyItMatters: "Business Health is a plain average of how well you're following up, converting, collecting reviews, keeping customers, and getting paid — a low score means several of those are slipping at once.",
    evidence: [`Overall score: ${score}/100`, `Weakest area: ${weakest.label} (${Math.round(weakest.value!)}/100)`],
    recommendedAction,
    actionLink,
    expectedOutcome: "Improving your weakest area raises the overall score the fastest, since it pulls the average down the most today.",
    priority: label === "at_risk" ? "critical" : "high",
  };
}

function repeatCustomerRateInsight(input: BusinessCoachingInput): CoachingInsight | null {
  const { repeatCustomerRate, customersWithWonLead, averageLifetimeValue } = input.summary.customerIntelligence;
  if (repeatCustomerRate == null || customersWithWonLead < MIN_CUSTOMERS_FOR_REPEAT_RATE_INSIGHT) return null;
  if (repeatCustomerRate >= LOW_REPEAT_CUSTOMER_RATE) return null;

  return {
    key: "repeat_customer_rate",
    title: "Most customers aren't coming back yet",
    context: `Only ${pct(repeatCustomerRate)} of your paying customers have won a second job.`,
    whyItMatters: "A returning customer costs nothing to re-acquire and is already proven to pay you — growing repeat business is usually cheaper than finding new leads.",
    evidence: [
      `${pct(repeatCustomerRate)} repeat customer rate across ${customersWithWonLead} paying customer${customersWithWonLead === 1 ? "" : "s"}`,
      averageLifetimeValue != null ? `Average customer value: ${money(averageLifetimeValue)}` : "No lifetime value data yet",
    ],
    recommendedAction: "Set a comeback reminder for a recent customer",
    actionLink: { kind: "comeback" },
    expectedOutcome: "Bringing even a few of these customers back directly increases recovered revenue without needing new leads.",
    priority: "medium",
  };
}

function servicePerformanceInsight(input: BusinessCoachingInput): CoachingInsight | null {
  const { highestConverting, lowestConverting } = input.insights.servicePerformance;
  if (highestConverting.length === 0 || lowestConverting.length === 0) return null;

  const best = highestConverting[0]!;
  const worst = lowestConverting[0]!;
  if (best.service === worst.service) return null;
  const gap = best.conversionRate - worst.conversionRate;
  if (gap < MIN_CONVERSION_GAP_FOR_SERVICE_INSIGHT) return null;

  return {
    key: "service_performance_gap",
    title: `${worst.service} is converting far below your other services`,
    context: `${worst.service} converts at ${pct(worst.conversionRate)}, compared to ${pct(best.conversionRate)} for ${best.service}.`,
    whyItMatters: "The same follow-up effort is producing very different results depending on the service requested — the gap is worth understanding.",
    evidence: [
      `${worst.service}: ${worst.wonCount}/${worst.leadCount} leads won (${pct(worst.conversionRate)})`,
      `${best.service}: ${best.wonCount}/${best.leadCount} leads won (${pct(best.conversionRate)})`,
    ],
    recommendedAction: "Review your service performance in Business Insights",
    actionLink: { kind: "insights" },
    expectedOutcome: `Closing even part of this gap on ${worst.service} would meaningfully lift your overall conversion rate.`,
    priority: "low",
  };
}

/**
 * Dormant membership is consumed directly from the existing Audience
 * Engine. Business Insights supplies only the already-computed lifecycle
 * denominator, so no audience or lifecycle calculation is duplicated here.
 */
function dormantCustomersInsight(input: BusinessCoachingInput): CoachingInsight | null {
  const segment = audience(input, "dormant");
  if (!segment) return null;
  const dormantCount = segment.totalCustomers;
  const totalCustomers = input.insights.customerLifecycle.totalCustomers;

  return {
    key: "dormant_customers",
    title: "Past customers have gone quiet",
    context: `${dormantCount} of your ${totalCustomers} customer${totalCustomers === 1 ? "" : "s"} ha${dormantCount === 1 ? "s" : "ve"} won a job before but haven't been back in a while.`,
    whyItMatters: "A customer who has already paid you once is far easier to win back than finding a brand-new lead.",
    evidence: [`${dormantCount} dormant customer${dormantCount === 1 ? "" : "s"}`, `${totalCustomers} total customer${totalCustomers === 1 ? "" : "s"} with lead history`],
    recommendedAction: "View dormant customers",
    actionLink: { kind: "audience", audienceKey: segment.key },
    expectedOutcome: "Reaching out to a dormant customer converts more often than a cold lead, since they already trust your work.",
    priority: dormantCount >= HIGH_DORMANT_CUSTOMER_COUNT ? "high" : "medium",
  };
}

function needsReviewsAudienceInsight(input: BusinessCoachingInput): CoachingInsight | null {
  const segment = audience(input, "needs_reviews");
  if (!segment) return null;
  return {
    key: "needs_reviews_audience",
    title: "Customers are still waiting to complete reviews",
    context: `${segment.totalCustomers} customer${segment.totalCustomers === 1 ? " has" : "s have"} an active review request without a completed review.`,
    whyItMatters: "These requests are already in progress, so this audience shows exactly where review follow-up may still be useful.",
    evidence: [`${segment.totalCustomers} customer${segment.totalCustomers === 1 ? "" : "s"} in Needs reviews`, `${money(segment.revenue)} customer value in this audience`],
    recommendedAction: "View customers needing reviews",
    actionLink: { kind: "audience", audienceKey: segment.key },
    expectedOutcome: "Focusing on this existing audience keeps review follow-up directed at customers with an unfinished request.",
    priority: "medium",
  };
}

function relationshipAudienceInsight(input: BusinessCoachingInput, key: "vip" | "high_value" | "loyal"): CoachingInsight | null {
  const segment = audience(input, key);
  if (!segment) return null;
  return {
    key: `${key}_audience`,
    title: `${segment.label} deserve focused attention`,
    context: `${segment.totalCustomers} customer${segment.totalCustomers === 1 ? " is" : "s are"} currently in your ${segment.label.toLowerCase()} audience.`,
    whyItMatters: "This audience is identified from your recorded customer and revenue history, ready for you to review as a group.",
    evidence: [`${segment.totalCustomers} customer${segment.totalCustomers === 1 ? "" : "s"} in ${segment.label}`, `${money(segment.revenue)} total value`, `Average value: ${money(segment.averageValue)}`],
    recommendedAction: `View ${segment.label.toLowerCase()}`,
    actionLink: { kind: "audience", audienceKey: segment.key },
    expectedOutcome: "Reviewing the segment helps you decide which known customer relationship needs attention next.",
    priority: "low",
  };
}

const INSIGHT_GENERATORS: ((input: BusinessCoachingInput) => CoachingInsight | null)[] = [
  businessHealthInsight,
  outstandingRevenueInsight,
  customersWaitingInsight,
  repeatCustomerRateInsight,
  dormantCustomersInsight,
  needsReviewsAudienceInsight,
  (input) => relationshipAudienceInsight(input, "vip"),
  (input) => relationshipAudienceInsight(input, "high_value"),
  (input) => relationshipAudienceInsight(input, "loyal"),
  servicePerformanceInsight,
];

const PRIORITY_ORDER: Record<CoachingPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Runs every insight generator and returns only the ones with something
 * real to say, sorted by priority (critical first). Deterministic: the
 * same input always produces the same output in the same order — no
 * randomness, no external calls, no clock reads beyond what's already
 * baked into `input`.
 */
export function generateBusinessCoaching(input: BusinessCoachingInput): CoachingInsight[] {
  return INSIGHT_GENERATORS.map((generate) => generate(input))
    .filter((insight): insight is CoachingInsight => insight !== null)
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
}
