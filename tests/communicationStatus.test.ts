import { describe, expect, it } from "vitest";
import { deriveCommunicationStatuses } from "../src/lib/communicationStatus.js";

const base = { hasOpenLead: false, hasPendingReviewRequest: false, hasDueReminder: false, hasOutstandingPayment: false, lifecycleStage: "new_lead" as const };

describe("deriveCommunicationStatuses", () => {
  it("returns nothing for a customer with no open items and a neutral lifecycle stage", () => {
    expect(deriveCommunicationStatuses({ ...base, lifecycleStage: "contacted" })).toEqual([]);
  });

  it("flags waiting_for_follow_up for an open lead", () => {
    expect(deriveCommunicationStatuses({ ...base, hasOpenLead: true })).toContain("waiting_for_follow_up");
  });

  it("flags waiting_for_review for a pending review request", () => {
    expect(deriveCommunicationStatuses({ ...base, hasPendingReviewRequest: true })).toContain("waiting_for_review");
  });

  it("flags reminder_scheduled for a due reminder", () => {
    expect(deriveCommunicationStatuses({ ...base, hasDueReminder: true })).toContain("reminder_scheduled");
  });

  it("flags payment_outstanding for an outstanding payment", () => {
    expect(deriveCommunicationStatuses({ ...base, hasOutstandingPayment: true })).toContain("payment_outstanding");
  });

  it("flags dormant for a dormant lifecycle stage", () => {
    expect(deriveCommunicationStatuses({ ...base, lifecycleStage: "dormant" })).toEqual(["dormant"]);
  });

  it("flags customer_returned for returning/loyal/vip stages", () => {
    expect(deriveCommunicationStatuses({ ...base, lifecycleStage: "returning" })).toContain("customer_returned");
    expect(deriveCommunicationStatuses({ ...base, lifecycleStage: "loyal" })).toContain("customer_returned");
    expect(deriveCommunicationStatuses({ ...base, lifecycleStage: "vip" })).toContain("customer_returned");
  });

  it("never flags both dormant and customer_returned at once", () => {
    const statuses = deriveCommunicationStatuses({ ...base, lifecycleStage: "dormant" });
    expect(statuses).not.toContain("customer_returned");
  });

  it("can combine multiple independent statuses at once", () => {
    const statuses = deriveCommunicationStatuses({ hasOpenLead: true, hasPendingReviewRequest: true, hasDueReminder: true, hasOutstandingPayment: true, lifecycleStage: "dormant" });
    expect(statuses).toEqual(["waiting_for_follow_up", "waiting_for_review", "reminder_scheduled", "payment_outstanding", "dormant"]);
  });
});
