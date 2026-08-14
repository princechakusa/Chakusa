import { prisma } from "../../lib/prisma.js";

/**
 * The complete, paginated action queue behind "See All" — a P1 scale fix
 * for the audit finding that Attention Center only ever saw
 * dashboard.summary()'s todayAttentionItems preview (a single category,
 * hardcoded take:10, no pagination — see dashboard.service.ts). This is a
 * new, additive endpoint; dashboard.summary()'s existing preview shape is
 * untouched so mobile's current DashboardScreen keeps working unmodified.
 *
 * Three categories, each independently paginated and each backed by an
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
 */
export type AttentionCategory = "missed_call_followup" | "customer_due" | "review_opportunity";

export interface AttentionItem {
  category: AttentionCategory;
  id: string;
  customerId: string | null;
  customerName: string | null;
  detail: string | null;
  occurredAt: string;
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
    detail: lead.serviceRequested,
    occurredAt: lead.createdAt.toISOString(),
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
    detail: reminder.serviceName,
    occurredAt: reminder.dueDate.toISOString(),
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
    detail: review.serviceName,
    occurredAt: review.createdAt.toISOString(),
  }));
  return { items: results, total };
}

const CATEGORY_PAGERS: Record<AttentionCategory, typeof pageMissedCallFollowUps> = {
  missed_call_followup: pageMissedCallFollowUps,
  customer_due: pageCustomersDue,
  review_opportunity: pageReviewOpportunities,
};

/**
 * `category` selects a single paginated category (the "See All" case —
 * one category at a time, real page/pageSize, real total). Omitting it
 * returns a small merged preview across all three categories, each capped
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

  const [missedCalls, customersDue, reviewOpportunities] = await Promise.all([
    pageMissedCallFollowUps(businessId, { page: 1, pageSize: opts.pageSize }),
    pageCustomersDue(businessId, { page: 1, pageSize: opts.pageSize }),
    pageReviewOpportunities(businessId, { page: 1, pageSize: opts.pageSize }),
  ]);

  return {
    items: [...missedCalls.items, ...customersDue.items, ...reviewOpportunities.items],
    total: missedCalls.total + customersDue.total + reviewOpportunities.total,
    page: 1,
    pageSize: opts.pageSize,
    category: null,
    countsByCategory: {
      missed_call_followup: missedCalls.total,
      customer_due: customersDue.total,
      review_opportunity: reviewOpportunities.total,
    },
  };
}
