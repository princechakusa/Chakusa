import { describe, expect, it } from "vitest";
import { delayUntil } from "../src/lib/automation/delayEngine.js";
import { evaluateCondition, isWithinBusinessHours } from "../src/lib/automation/conditionEngine.js";
import { nextWorkflowTriggerAt } from "../src/lib/automation/workflowScheduling.js";
import type { WorkflowDefinition } from "../src/lib/automation/workflowContracts.js";

const schedule = (hour: number, minute: number): WorkflowDefinition => ({ trigger: { type: "SCHEDULED", config: { hour, minute } }, nodes: [] });
const weekdays = { mon: { start: "09:00", end: "17:00" }, tue: { start: "09:00", end: "17:00" }, wed: { start: "09:00", end: "17:00" }, thu: { start: "09:00", end: "17:00" }, fri: { start: "09:00", end: "17:00" } };

describe("production scheduling semantics", () => {
  it("does not schedule the repeated DST fall-back wall time twice", () => {
    expect(nextWorkflowTriggerAt(schedule(1, 30), "America/New_York", new Date("2026-11-01T05:30:00Z"))?.toISOString()).toBe("2026-11-02T06:30:00.000Z");
  });
  it("advances business days by local calendar and skips holidays", () => {
    expect(delayUntil(new Date("2026-03-06T14:30:00Z"), { amount: 1, unit: "business_days", timezone: "America/New_York", workingHours: weekdays, holidays: ["2026-03-09"] }).toISOString()).toBe("2026-03-10T13:30:00.000Z");
  });
  it("supports overnight hours and exact minute delays", () => {
    const hours = { mon: { start: "22:00", end: "02:00" } };
    expect(isWithinBusinessHours(new Date("2026-09-01T01:00:00Z"), "UTC", hours)).toBe(true);
    expect(delayUntil(new Date("2026-08-31T21:59:00Z"), { amount: 0.5, unit: "business_hours", timezone: "UTC", workingHours: hours }).toISOString()).toBe("2026-08-31T22:29:00.000Z");
  });
});

describe("production condition expressions", () => {
  const context = { customer: { tags: ["vip"] }, appointment: { startsAt: "2026-09-01T10:00:00Z" }, payment: { status: "paid" } };
  it("supports NOT, date windows, tags, and string operators", () => {
    expect(evaluateCondition({ operator: "AND", conditions: [{ field: "customer.tags", operator: "contains", value: "vip" }, { field: "appointment.startsAt", operator: "between", value: ["2026-09-01T09:00:00Z", "2026-09-01T11:00:00Z"] }, { operator: "NOT", conditions: [{ field: "payment.status", operator: "starts_with", value: "fail" }] }] }, context)).toBe(true);
  });
  it("treats invalid regular expressions as a failed condition", () => {
    expect(evaluateCondition({ field: "payment.status", operator: "matches", value: "[" }, context)).toBe(false);
  });
});
