import { Prisma } from "@prisma/client";
import { prisma } from "../../prisma.js";
import { ApiError } from "../../errors.js";

export const AI_OUTCOME_TYPES = ["booking", "payment", "review", "quote", "revenue"] as const;
export type AIOutcomeType = (typeof AI_OUTCOME_TYPES)[number];

/** Records an AI-assisted outcome (unverified). Idempotent per (business, type, outcomeId). */
export async function attributeAIOutcome(input: {
  businessId: string;
  outcomeType: AIOutcomeType;
  outcomeId: string;
  runId?: string | null;
  conversationId?: string | null;
  customerId?: string | null;
  amount?: number | null;
  currency?: string | null;
  ledgerId?: string | null;
}) {
  if (!AI_OUTCOME_TYPES.includes(input.outcomeType)) throw ApiError.badRequest(`Unknown outcome type: ${input.outcomeType}`);
  return prisma.aIAttributedOutcome.upsert({
    where: { businessId_outcomeType_outcomeId: { businessId: input.businessId, outcomeType: input.outcomeType, outcomeId: input.outcomeId } },
    create: {
      businessId: input.businessId,
      outcomeType: input.outcomeType,
      outcomeId: input.outcomeId,
      runId: input.runId ?? null,
      conversationId: input.conversationId ?? null,
      customerId: input.customerId ?? null,
      amount: input.amount != null ? new Prisma.Decimal(input.amount) : null,
      currency: input.currency ?? null,
      ledgerId: input.ledgerId ?? null,
    },
    update: { runId: input.runId ?? undefined, amount: input.amount != null ? new Prisma.Decimal(input.amount) : undefined },
  });
}

/**
 * Re-checks each unverified outcome against its system of record and flips
 * `verified` when the underlying event is real (appointment booked, payment
 * paid, feedback submitted). Analytics only ever counts verified rows.
 */
export async function verifyAIOutcomes(businessId: string) {
  const pending = await prisma.aIAttributedOutcome.findMany({ where: { businessId, verified: false } });
  let verified = 0;
  for (const outcome of pending) {
    let ok = false;
    let amount = outcome.amount;
    if (outcome.outcomeType === "booking") {
      const appointment = await prisma.appointment.findFirst({ where: { id: outcome.outcomeId, businessId, status: { in: ["SCHEDULED", "CONFIRMED", "COMPLETED"] } }, select: { price: true } });
      ok = Boolean(appointment);
      if (appointment?.price != null) amount = appointment.price;
    } else if (outcome.outcomeType === "payment" || outcome.outcomeType === "revenue") {
      const payment = await prisma.appointmentPaymentTransaction.findFirst({ where: { id: outcome.outcomeId, businessId, status: "paid" }, select: { amount: true } });
      ok = Boolean(payment);
      if (payment?.amount != null) amount = payment.amount;
    } else if (outcome.outcomeType === "review") {
      ok = Boolean(await prisma.feedback.findFirst({ where: { id: outcome.outcomeId, businessId }, select: { id: true } }));
    } else if (outcome.outcomeType === "quote") {
      // A quote counts once it converts to a real appointment for the customer.
      ok = Boolean(outcome.customerId && (await prisma.appointment.findFirst({ where: { businessId, customerId: outcome.customerId, createdAt: { gte: outcome.createdAt } }, select: { id: true } })));
    }
    if (ok) {
      await prisma.aIAttributedOutcome.update({ where: { id: outcome.id }, data: { verified: true, verifiedAt: new Date(), amount } });
      verified += 1;
    }
  }
  return { checked: pending.length, verified };
}

/** AI slice of the Value Center — verified events only. */
export async function getAIValueCenter(businessId: string) {
  const [runs, completed, escalated, decisions, ledger, outcomes] = await Promise.all([
    prisma.aIConversationRun.count({ where: { businessId } }),
    prisma.aIConversationRun.count({ where: { businessId, status: "COMPLETED" } }),
    prisma.aIConversationRun.count({ where: { businessId, status: "ESCALATED" } }),
    prisma.aIPolicyDecision.groupBy({ by: ["outcome"], where: { businessId }, _count: { _all: true } }),
    prisma.aIInvocationLedger.aggregate({ where: { businessId }, _sum: { cost: true, inputTokens: true, outputTokens: true }, _count: { _all: true } }),
    prisma.aIAttributedOutcome.groupBy({ by: ["outcomeType"], where: { businessId, verified: true }, _count: { _all: true }, _sum: { amount: true } }),
  ]);

  const outcomeMap = new Map(outcomes.map((row) => [row.outcomeType, { count: row._count._all, amount: Number(row._sum.amount ?? 0) }]));
  const bookings = outcomeMap.get("booking")?.count ?? 0;
  const payments = outcomeMap.get("payment")?.count ?? 0;
  const reviews = outcomeMap.get("review")?.count ?? 0;
  const quotes = outcomeMap.get("quote")?.count ?? 0;
  const assistedRevenue = Number(((outcomeMap.get("payment")?.amount ?? 0) + (outcomeMap.get("revenue")?.amount ?? 0)).toFixed(2));

  const cost = Number(Number(ledger._sum.cost ?? 0).toFixed(4));
  const decisionTotal = decisions.reduce((sum, row) => sum + row._count._all, 0);
  const approvals = decisions.find((row) => row.outcome === "REQUIRE_APPROVAL")?._count._all ?? 0;
  const escalateDecisions = decisions.find((row) => row.outcome === "ESCALATE")?._count._all ?? 0;

  return {
    aiConversations: runs,
    completedConversations: completed,
    aiAssistedBookings: bookings,
    aiAssistedPayments: payments,
    aiAssistedReviews: reviews,
    aiAssistedQuotes: quotes,
    aiAssistedRevenue: assistedRevenue,
    aiCost: cost,
    tokens: { input: ledger._sum.inputTokens ?? 0, output: ledger._sum.outputTokens ?? 0 },
    costPerConversation: runs ? Number((cost / runs).toFixed(4)) : 0,
    costPerBooking: bookings ? Number((cost / bookings).toFixed(4)) : 0,
    humanApprovalRate: decisionTotal ? Number((approvals / decisionTotal).toFixed(4)) : 0,
    escalationRate: runs ? Number(((escalated + escalateDecisions) / Math.max(runs, decisionTotal || runs)).toFixed(4)) : 0,
    aiRoi: cost > 0 ? Number(((assistedRevenue - cost) / cost).toFixed(4)) : null,
    verifiedEventsOnly: true,
  };
}
