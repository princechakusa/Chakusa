import { describe, expect, it } from "vitest";
import { buildCommunicationTimeline } from "../src/lib/communicationTimeline.js";
import { Prisma, type Feedback, type Lead, type Message, type Reminder, type ReviewRequest } from "@prisma/client";

const NOW = new Date("2026-06-15T12:00:00Z");

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    businessId: "biz-1",
    customerId: "cust-1",
    source: "missed_call",
    clientEventId: null,
    missedCallTime: null,
    serviceRequested: "Haircut",
    urgency: "medium",
    status: "new",
    estimatedValue: null,
    paymentStatus: "unpaid",
    paidAmount: null,
    referredByCustomerId: null,
    notes: null,
    generatedReply: null,
    contactedAt: null,
    bookedAt: null,
    wonAt: null,
    lostAt: null,
    createdAt: new Date("2026-06-01T10:00:00Z"),
    updatedAt: new Date("2026-06-01T10:00:00Z"),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Lead;
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-1",
    businessId: "biz-1",
    customerId: "cust-1",
    leadId: "lead-1",
    messageType: "missed_call",
    channel: "sms",
    body: "Hi, sorry we missed your call.",
    status: "sent",
    sentAt: new Date("2026-06-01T10:05:00Z"),
    provider: "twilio",
    providerMessageId: "SM1",
    automationRunId: null,
    createdAt: new Date("2026-06-01T10:05:00Z"),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Message;
}

function makeReview(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    id: "review-1",
    businessId: "biz-1",
    customerId: "cust-1",
    serviceName: "Haircut",
    message: null,
    status: "pending",
    googleReviewLink: null,
    privateFeedbackUrl: null,
    sentAt: null,
    publicTokenId: null,
    publicTokenHash: null,
    publicTokenExpiresAt: null,
    publicTokenConsumedAt: null,
    createdAt: new Date("2026-06-02T10:00:00Z"),
    updatedAt: new Date("2026-06-02T10:00:00Z"),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as ReviewRequest;
}

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: "reminder-1",
    businessId: "biz-1",
    customerId: "cust-1",
    serviceName: "Haircut",
    lastVisitDate: null,
    dueDate: new Date("2026-06-10T10:00:00Z"),
    message: null,
    status: "due",
    createdAt: new Date("2026-06-03T10:00:00Z"),
    updatedAt: new Date("2026-06-03T10:00:00Z"),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Reminder;
}

function makeFeedback(overrides: Partial<Feedback> = {}): Feedback {
  return {
    id: "feedback-1",
    businessId: "biz-1",
    customerId: "cust-1",
    reviewRequestId: "review-1",
    rating: 5,
    comment: null,
    sentiment: "positive",
    status: "new",
    createdAt: new Date("2026-06-04T10:00:00Z"),
    updatedAt: new Date("2026-06-04T10:00:00Z"),
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as Feedback;
}

const empty = { leads: [], messages: [], reviewRequests: [], feedback: [], reminders: [], now: NOW };

describe("buildCommunicationTimeline", () => {
  it("returns nothing for a customer with no repository-backed events", () => {
    expect(buildCommunicationTimeline(empty)).toEqual([]);
  });

  it("emits a lead_created entry tagged needs_action while the lead is still open", () => {
    const entries = buildCommunicationTimeline({ ...empty, leads: [makeLead({ status: "new" })] });
    const entry = entries.find((e) => e.kind === "lead_created")!;
    expect(entry.filters).toContain("recovery");
    expect(entry.filters).toContain("needs_action");
  });

  it("does not tag a won lead's creation event as needing action", () => {
    const entries = buildCommunicationTimeline({ ...empty, leads: [makeLead({ status: "won" })] });
    const entry = entries.find((e) => e.kind === "lead_created")!;
    expect(entry.filters).not.toContain("needs_action");
  });

  it("emits a payment_recorded entry only for a won lead with a non-unpaid status", () => {
    const withPayment = buildCommunicationTimeline({ ...empty, leads: [makeLead({ status: "won", paymentStatus: "paid", estimatedValue: new Prisma.Decimal(100), paidAmount: new Prisma.Decimal(100) })] });
    expect(withPayment.some((e) => e.kind === "payment_recorded")).toBe(true);

    const withoutPayment = buildCommunicationTimeline({ ...empty, leads: [makeLead({ status: "won", paymentStatus: "unpaid" })] });
    expect(withoutPayment.some((e) => e.kind === "payment_recorded")).toBe(false);
  });

  it("tags a partial payment as needing action, but a full payment as not", () => {
    const partial = buildCommunicationTimeline({ ...empty, leads: [makeLead({ status: "won", paymentStatus: "partially_paid", estimatedValue: new Prisma.Decimal(100), paidAmount: new Prisma.Decimal(50) })] });
    expect(partial.find((e) => e.kind === "payment_recorded")!.filters).toContain("needs_action");

    const full = buildCommunicationTimeline({ ...empty, leads: [makeLead({ status: "won", paymentStatus: "paid", estimatedValue: new Prisma.Decimal(100), paidAmount: new Prisma.Decimal(100) })] });
    expect(full.find((e) => e.kind === "payment_recorded")!.filters).not.toContain("needs_action");
  });

  it("classifies a missed_call message as missed_call_recovered regardless of automation origin", () => {
    const manual = buildCommunicationTimeline({ ...empty, messages: [makeMessage({ messageType: "missed_call", automationRunId: null })] });
    expect(manual[0]!.kind).toBe("missed_call_recovered");
    expect(manual[0]!.filters).toContain("manual");

    const automated = buildCommunicationTimeline({ ...empty, messages: [makeMessage({ messageType: "missed_call", automationRunId: "run-1" })] });
    expect(automated[0]!.kind).toBe("missed_call_recovered");
    expect(automated[0]!.filters).toContain("automated");
  });

  it("classifies a lead_follow_up message by automation origin", () => {
    const manual = buildCommunicationTimeline({ ...empty, messages: [makeMessage({ messageType: "lead_follow_up", automationRunId: null })] });
    expect(manual[0]!.kind).toBe("follow_up_manual");

    const automated = buildCommunicationTimeline({ ...empty, messages: [makeMessage({ messageType: "lead_follow_up", automationRunId: "run-1" })] });
    expect(automated[0]!.kind).toBe("follow_up_automated");
  });

  it("never emits an entry for a draft (never sent) message", () => {
    const entries = buildCommunicationTimeline({ ...empty, messages: [makeMessage({ status: "draft" })] });
    expect(entries).toEqual([]);
  });

  it("skips review_request and private_feedback messages to avoid duplicating the ReviewRequest-sourced entries", () => {
    const entries = buildCommunicationTimeline({
      ...empty,
      messages: [makeMessage({ messageType: "review_request" }), makeMessage({ id: "msg-2", messageType: "private_feedback" })],
    });
    expect(entries).toEqual([]);
  });

  it("tags a failed message as needing action", () => {
    const entries = buildCommunicationTimeline({ ...empty, messages: [makeMessage({ status: "failed" })] });
    expect(entries[0]!.filters).toContain("needs_action");
    expect(entries[0]!.tone).toBe("attention");
  });

  it("emits review_requested only once a review request has actually been sent", () => {
    const notSent = buildCommunicationTimeline({ ...empty, reviewRequests: [makeReview({ sentAt: null })] });
    expect(notSent.some((e) => e.kind === "review_requested")).toBe(false);

    const sent = buildCommunicationTimeline({ ...empty, reviewRequests: [makeReview({ sentAt: new Date("2026-06-02T11:00:00Z"), status: "sent" })] });
    const entry = sent.find((e) => e.kind === "review_requested")!;
    expect(entry.filters).toContain("needs_action");
  });

  it("emits review_completed with the linked feedback rating when feedback was received", () => {
    const entries = buildCommunicationTimeline({
      ...empty,
      reviewRequests: [makeReview({ status: "feedback_received" })],
      feedback: [makeFeedback({ reviewRequestId: "review-1", rating: 4 })],
    });
    const entry = entries.find((e) => e.kind === "review_completed")!;
    expect(entry.detail).toContain("4/5");
  });

  it("tags a due, unfulfilled reminder as needing action", () => {
    const entries = buildCommunicationTimeline({ ...empty, reminders: [makeReminder({ status: "due", dueDate: new Date("2026-06-01T00:00:00Z") })] });
    const created = entries.find((e) => e.kind === "reminder_created")!;
    expect(created.filters).toContain("needs_action");
  });

  it("does not tag a reminder due in the future as needing action", () => {
    const entries = buildCommunicationTimeline({ ...empty, reminders: [makeReminder({ status: "due", dueDate: new Date("2026-07-01T00:00:00Z") })] });
    const created = entries.find((e) => e.kind === "reminder_created")!;
    expect(created.filters).not.toContain("needs_action");
  });

  it("emits a success-toned reminder_completed entry when a reminder is completed", () => {
    const entries = buildCommunicationTimeline({ ...empty, reminders: [makeReminder({ status: "completed" })] });
    const completed = entries.find((e) => e.kind === "reminder_completed")!;
    expect(completed.tone).toBe("success");
    expect(completed.title).toContain("returned");
  });

  it("sorts every entry newest-first regardless of source type", () => {
    const entries = buildCommunicationTimeline({
      leads: [makeLead({ id: "lead-old", createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") })],
      messages: [makeMessage({ id: "msg-new", sentAt: new Date("2026-06-10T00:00:00Z") })],
      reviewRequests: [],
      feedback: [],
      reminders: [makeReminder({ id: "reminder-mid", createdAt: new Date("2026-03-01T00:00:00Z") })],
      now: NOW,
    });
    const timestamps = entries.map((e) => e.at.getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => b - a));
  });
});
