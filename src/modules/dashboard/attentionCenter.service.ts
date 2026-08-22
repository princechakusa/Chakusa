import { prisma } from "../../lib/prisma.js";

/**
 * The complete, paginated action queue behind "See All" — a P1 scale fix
 * for the audit finding that Attention Center only ever saw
 * dashboard.summary()'s todayAttentionItems preview (a single category,
 * hardcoded take:10, no pagination — see dashboard.service.ts). This is a
 * new, additive endpoint; dashboard.summary()'s existing preview shape is
 * untouched so mobile's current DashboardScreen keeps working unmodified.
 *
 * Four categories, each independently paginated and each backed by an
 * existing (businessId, status) index — no new index or denormalized
 * table required:
 *   - missed_call_followup: Leads with status "new" (a missed call that
 *     hasn't been contacted yet), oldest first — matches the existing
 *     recovery workflow's urgency ordering.
 *   - customer_due: Reminders that are actually due now (status "due" AND
 *     dueDate has passed — the same isDueNow definition used elsewhere in
 *     this pass, never a future-scheduled reminder), soonest-overdue first.
 *   - review_opportunity: ReviewRequests still "pending" (created but never
 *     sent) — the actionable "you could send this" opportunity, oldest
 *     first.
 *   - payment_outstanding: Won leads not yet fully paid — the same
 *     definition dashboard.service.ts's outstanding-revenue figure and
 *     recommendations.ts's "collect outstanding revenue" nudge already
 *     use, oldest-won first (the longest-outstanding debt is the most
 *     worth chasing).
 *
 * `message` carries whatever pre-rendered text already exists for that
 * item (Lead.generatedReply / Reminder.message / ReviewRequest.message) —
 * never generated here — so the Customer Action Center can offer a
 * one-tap "open WhatsApp" quick action only when there's real text to
 * send, and falls back to "View" (which can generate one) otherwise.
 * `amount` is populated only for payment_outstanding, as the lead's full
 * estimatedValue — the exact value a one-tap "Mark paid" action passes to
 * leads.service.ts's existing updateLeadPayment as `paidAmount`.
 */
export type AttentionCategory = "missed_call_followup" | "customer_due" | "review_opportunity" | "payment_outstanding";

export interface AttentionItem {
  category: AttentionCategory;
  id: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  detail: string | null;
  occurredAt: string;
  message: string | null;
  amount: number | null;
}

interface PageOpts {
  page: number;
  pageSize: number;
}

async function pageMissedCallFollowUps(businessId: string, opts: PageOpts) {
  const where = { businessId, status: "new" as const };
  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: { customer: true },
    }),
    prisma.lead.count({ where }),
  ]);
  const results: AttentionItem[] = items.map((lead) => ({
    category: "missed_call_followup",
    id: lead.id,
    customerId: lead.customerId,
    customerName: lead.customer?.name ?? null,
    customerPhone: lead.customer?.phone ?? null,
    detail: lead.serviceRequested,
    occurredAt: lead.createdAt.toISOString(),
    message: lead.generatedReply,
    amount: null,
  }));
  return { items: results, total };
}

async function pageCustomersDue(businessId: string, opts: PageOpts) {
  const where = { businessId, status: "due" as const, dueDate: { lte: new Date() } };
  const [items, total] = await Promise.all([
    prisma.reminder.findMany({
      where,
      orderBy: { dueDate: "asc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: { customer: true },
    }),
    prisma.reminder.count({ where }),
  ]);
  const results: AttentionItem[] = items.map((reminder) => ({
    category: "customer_due",
    id: reminder.id,
    customerId: reminder.customerId,
    customerName: reminder.customer?.name ?? null,
    customerPhone: reminder.customer?.phone ?? null,
    detail: reminder.serviceName,
    occurredAt: reminder.dueDate.toISOString(),
    message: reminder.message,
    amount: null,
  }));
  return { items: results, total };
}

async function pageReviewOpportunities(businessId: string, opts: PageOpts) {
  const where = { businessId, status: "pending" as const };
  const [items, total] = await Promise.all([
    prisma.reviewRequest.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: { customer: true },
    }),
    prisma.reviewRequest.count({ where }),
  ]);
  const results: AttentionItem[] = items.map((review) => ({
    category: "review_opportunity",
    id: review.id,
    customerId: review.customerId,
    customerName: review.customer?.name ?? null,
    customerPhone: review.customer?.phone ?? null,
    detail: review.serviceName,
    occurredAt: review.createdAt.toISOString(),
    message: review.message,
    amount: null,
  }));
  return { items: results, total };
}

async function pagePaymentOutstanding(businessId: string, opts: PageOpts) {
  const where = { businessId, status: "won" as const, paymentStatus: { not: "paid" as const }, estimatedValue: { not: null } };
  const [items, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { wonAt: "asc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
      include: { customer: true },
    }),
    prisma.lead.count({ where }),
  ]);
  const results: AttentionItem[] = items.map((lead) => {
    const estimatedValue = Number(lead.estimatedValue ?? 0);
    const outstanding = estimatedValue - Number(lead.paidAmount ?? 0);
    return {
      category: "payment_outstanding",
      id: lead.id,
      customerId: lead.customerId,
      customerName: lead.customer?.name ?? null,
      customerPhone: lead.customer?.phone ?? null,
      detail: `$${outstanding.toFixed(2)} outstanding`,
      occurredAt: (lead.wonAt ?? lead.createdAt).toISOString(),
      message: null,
      amount: estimatedValue,
    };
  });
  return { items: results, total };
}

const CATEGORY_PAGERS: Record<AttentionCategory, typeof pageMissedCallFollowUps> = {
  missed_call_followup: pageMissedCallFollowUps,
  customer_due: pageCustomersDue,
  review_opportunity: pageReviewOpportunities,
  payment_outstanding: pagePaymentOutstanding,
};

/**
 * `category` selects a single paginated category (the "See All" case —
 * one category at a time, real page/pageSize, real total). Omitting it
 * returns a small merged preview across all four categories, each capped
 * at `pageSize`, for a combined-queue landing view — still bounded, never
 * the entire table.
 */
export async function listAttentionItems(
  businessId: string,
  opts: { category?: AttentionCategory; page: number; pageSize: number },
) {
  if (opts.category) {
    const { items, total } = await CATEGORY_PAGERS[opts.category](businessId, opts);
    return { items, total, page: opts.page, pageSize: opts.pageSize, category: opts.category };
  }

  const [missedCalls, customersDue, reviewOpportunities, paymentOutstanding] = await Promise.all([
    pageMissedCallFollowUps(businessId, { page: 1, pageSize: opts.pageSize }),
    pageCustomersDue(businessId, { page: 1, pageSize: opts.pageSize }),
    pageReviewOpportunities(businessId, { page: 1, pageSize: opts.pageSize }),
    pagePaymentOutstanding(businessId, { page: 1, pageSize: opts.pageSize }),
  ]);

  return {
    items: [...missedCalls.items, ...customersDue.items, ...reviewOpportunities.items, ...paymentOutstanding.items],
    total: missedCalls.total + customersDue.total + reviewOpportunities.total + paymentOutstanding.total,
    page: 1,
    pageSize: opts.pageSize,
    category: null,
    countsByCategory: {
      missed_call_followup: missedCalls.total,
      customer_due: customersDue.total,
      review_opportunity: reviewOpportunities.total,
      payment_outstanding: paymentOutstanding.total,
    },
  };
}
