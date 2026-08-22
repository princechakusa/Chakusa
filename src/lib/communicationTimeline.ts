import type { Feedback, Lead, Message, Reminder, ReviewRequest } from "@prisma/client";

/**
 * The Conversation & Communication Center's unified per-customer timeline —
 * pure and DB-free, exactly like businessHealth.ts/customerLifecycle.ts:
 * this only reshapes rows a caller (customers.service.ts's
 * getCustomerProfile) already fetched. Every entry traces back to a real
 * row already in the repository; nothing here is estimated, predicted, or
 * synthesized. Two things explicitly mentioned in the Stage 9 brief are
 * deliberately NOT modeled as timeline *events* here:
 *
 *   - "Lifecycle transition" — a customer's lifecycle stage
 *     (customerLifecycle.ts) is a live classification recomputed from
 *     current data, not a stored state change with its own timestamp. There
 *     is no real "transitioned to dormant at time X" record to surface
 *     without inventing one, so the current stage is exposed as a status
 *     instead (see communicationStatus.ts), not a fabricated history event.
 *   - "Business Assistant recommendation generated" — coaching insights
 *     (businessCoaching.ts) are likewise a live recomputation, not a logged
 *     event. A customer-scoped highlight is surfaced separately (see
 *     customerCoachingHighlight.ts) rather than backdated into this list.
 */

export type CommunicationEventKind =
  | "lead_created"
  | "missed_call_recovered"
  | "follow_up_manual"
  | "follow_up_automated"
  | "review_requested"
  | "review_completed"
  | "reminder_created"
  | "reminder_completed"
  | "payment_recorded";

/** Mirrors Part 5's filter list exactly — a filter only ever contains entries that are already tagged with it, so an empty bucket simply never renders a tab (see mobile's CustomerProfileScreen). */
export type CommunicationFilter = "needs_action" | "automated" | "manual" | "reviews" | "payments" | "recovery";

export type CommunicationTone = "default" | "success" | "attention";

export interface CommunicationTimelineEntry {
  id: string;
  kind: CommunicationEventKind;
  at: Date;
  title: string;
  detail: string | null;
  tone: CommunicationTone;
  filters: CommunicationFilter[];
  /** What "View" should open — always an existing screen, never a new one. */
  source: { type: "lead"; leadId: string } | { type: "reviewRequest"; reviewRequestId: string } | { type: "reminder" } | { type: "message" };
}

export interface CommunicationTimelineInput {
  leads: Lead[];
  messages: Message[];
  reviewRequests: ReviewRequest[];
  feedback: Feedback[];
  reminders: Reminder[];
  now?: Date;
}

function money(value: unknown): string {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function leadEntries(leads: Lead[]): CommunicationTimelineEntry[] {
  const entries: CommunicationTimelineEntry[] = [];

  for (const lead of leads) {
    entries.push({
      id: `lead-created-${lead.id}`,
      kind: "lead_created",
      at: lead.createdAt,
      title: "Lead created",
      detail: lead.serviceRequested,
      tone: "default",
      filters: lead.status === "new" || lead.status === "contacted" ? ["recovery", "needs_action"] : ["recovery"],
      source: { type: "lead", leadId: lead.id },
    });

    // Payment tracking is entirely Lead.paymentStatus/paidAmount (see
    // dashboard.service.ts's recoveredRevenue.outstanding) — there is no
    // dedicated payment timestamp, so updatedAt (the same proxy already
    // used elsewhere for "when did this status last change") stands in.
    if (lead.status === "won" && lead.paymentStatus !== "unpaid") {
      entries.push({
        id: `payment-${lead.id}`,
        kind: "payment_recorded",
        at: lead.updatedAt,
        title: lead.paymentStatus === "paid" ? "Payment recorded" : "Partial payment recorded",
        detail: lead.paidAmount != null ? `${money(lead.paidAmount)} of ${money(lead.estimatedValue)}` : money(lead.estimatedValue),
        tone: lead.paymentStatus === "paid" ? "success" : "default",
        filters: lead.paymentStatus === "paid" ? ["payments"] : ["payments", "needs_action"],
        source: { type: "lead", leadId: lead.id },
      });
    }
  }

  return entries;
}

/**
 * Every message a customer received, manual or automated — reuses the
 * exact distinction executor.ts already encodes (Message.automationRunId
 * set only for automation-sent messages, see executor.ts's transaction).
 * Messages of type "review_request"/"private_feedback" are intentionally
 * skipped: they would duplicate the ReviewRequest-sourced entries below
 * (created/sent/completed), which are the more precise source of truth for
 * that lifecycle — Stage 9 explicitly forbids duplicating communication
 * history.
 */
function messageEntries(messages: Message[]): CommunicationTimelineEntry[] {
  const entries: CommunicationTimelineEntry[] = [];

  for (const message of messages) {
    if (message.status === "draft") continue; // never actually sent — nothing happened yet.
    if (message.messageType === "review_request" || message.messageType === "private_feedback") continue;

    const automated = message.automationRunId != null;
    const failed = message.status === "failed";
    const kind: CommunicationEventKind = message.messageType === "missed_call" ? "missed_call_recovered" : automated ? "follow_up_automated" : "follow_up_manual";

    const titleBase =
      message.messageType === "missed_call"
        ? "Missed call recovered"
        : message.messageType === "comeback_reminder"
          ? "Win-back message"
          : message.messageType === "booking_confirmation"
            ? "Booking confirmation"
            : message.messageType === "public_profile_inquiry"
              ? "Inquiry reply"
              : message.messageType === "lead_follow_up"
                ? "Follow-up nudge"
                : "Message";

    entries.push({
      id: `message-${message.id}`,
      kind,
      at: message.sentAt ?? message.createdAt,
      title: failed ? `${titleBase} — failed to send` : automated ? `${titleBase} (automated)` : titleBase,
      detail: message.channel === "sms" || message.channel === "whatsapp" ? message.body : null,
      tone: failed ? "attention" : "default",
      filters: failed
        ? ["needs_action", automated ? "automated" : "manual", ...(kind === "missed_call_recovered" ? (["recovery"] as const) : [])]
        : [automated ? "automated" : "manual", ...(kind === "missed_call_recovered" ? (["recovery"] as const) : ["recovery"] as const)],
      source: { type: "message" },
    });
  }

  return entries;
}

/**
 * "Review requested"/"review completed" are sourced from ReviewRequest's
 * own status/timestamps (sentAt, and updatedAt as the reviewed/feedback
 * proxy — the same proxy insights.service.ts's monthly trend already uses
 * for this exact status, since ReviewRequest has no dedicated
 * reviewedAt column), never from a Message row — see messageEntries above.
 */
function reviewRequestEntries(reviewRequests: ReviewRequest[], feedback: Feedback[]): CommunicationTimelineEntry[] {
  const entries: CommunicationTimelineEntry[] = [];
  const feedbackByReviewRequestId = new Map(feedback.filter((item) => item.reviewRequestId).map((item) => [item.reviewRequestId, item]));

  for (const review of reviewRequests) {
    if (review.sentAt) {
      entries.push({
        id: `review-requested-${review.id}`,
        kind: "review_requested",
        at: review.sentAt,
        title: "Review requested",
        detail: review.serviceName,
        tone: "default",
        filters: review.status === "sent" || review.status === "opened" ? ["reviews", "needs_action"] : ["reviews"],
        source: { type: "reviewRequest", reviewRequestId: review.id },
      });
    }

    if (review.status === "reviewed" || review.status === "feedback_received") {
      const linkedFeedback = feedbackByReviewRequestId.get(review.id);
      entries.push({
        id: `review-completed-${review.id}`,
        kind: "review_completed",
        at: review.updatedAt,
        title: review.status === "feedback_received" ? "Private feedback received" : "Review completed",
        detail: linkedFeedback ? `${linkedFeedback.rating}/5${review.serviceName ? ` · ${review.serviceName}` : ""}` : review.serviceName,
        tone: "success",
        filters: ["reviews"],
        source: { type: "reviewRequest", reviewRequestId: review.id },
      });
    }
  }

  return entries;
}

function reminderEntries(reminders: Reminder[], now: Date): CommunicationTimelineEntry[] {
  const entries: CommunicationTimelineEntry[] = [];

  for (const reminder of reminders) {
    const isDueNow = reminder.status === "due" && reminder.dueDate <= now;
    entries.push({
      id: `reminder-created-${reminder.id}`,
      kind: "reminder_created",
      at: reminder.createdAt,
      title: "Reminder created",
      detail: reminder.serviceName,
      tone: "default",
      filters: isDueNow ? ["recovery", "needs_action"] : ["recovery"],
      source: { type: "reminder" },
    });

    if (reminder.status === "completed" || reminder.status === "dismissed") {
      entries.push({
        id: `reminder-completed-${reminder.id}`,
        kind: "reminder_completed",
        at: reminder.updatedAt,
        title: reminder.status === "completed" ? "Reminder completed — customer returned" : "Reminder dismissed",
        detail: reminder.serviceName,
        tone: reminder.status === "completed" ? "success" : "default",
        filters: ["recovery"],
        source: { type: "reminder" },
      });
    }
  }

  return entries;
}

/**
 * Builds the full sorted timeline (newest first) from every existing
 * communication-bearing record for one customer. Deterministic: the same
 * input always produces the same output — no randomness, no clock reads
 * beyond the `now` already passed in for reminder due-ness.
 */
export function buildCommunicationTimeline(input: CommunicationTimelineInput): CommunicationTimelineEntry[] {
  const now = input.now ?? new Date();
  const entries = [
    ...leadEntries(input.leads),
    ...messageEntries(input.messages),
    ...reviewRequestEntries(input.reviewRequests, input.feedback),
    ...reminderEntries(input.reminders, now),
  ];
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime());
}
