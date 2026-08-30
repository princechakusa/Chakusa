import type { WorkflowDefinition } from "./workflowContracts.js";

export function isTimeTriggered(definition: WorkflowDefinition) {
  return ["SCHEDULED", "BIRTHDAY", "ANNIVERSARY"].includes(definition.trigger.type);
}

function localParts(date: Date, timezone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
}

export function nextWorkflowTriggerAt(definition: WorkflowDefinition, timezone: string, after = new Date()) {
  if (!isTimeTriggered(definition)) return null;
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(after); } catch { throw new Error("Scheduled trigger timezone is invalid"); }
  const hour = Number(definition.trigger.config?.hour ?? 9);
  const minute = Number(definition.trigger.config?.minute ?? 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new Error("Scheduled trigger time is invalid");
  const weekdays = Array.isArray(definition.trigger.config?.weekdays) ? new Set(definition.trigger.config.weekdays.map((item) => String(item).toLowerCase())) : null;
  const afterParts = localParts(after, timezone); const targetAlreadyReached = Number(afterParts.hour) > hour || (Number(afterParts.hour) === hour && Number(afterParts.minute) >= minute); const afterDay = `${afterParts.year}-${afterParts.month}-${afterParts.day}`;
  let candidate = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  for (let checked = 0; checked < 60 * 24 * 8; checked += 1, candidate = new Date(candidate.getTime() + 60_000)) {
    const parts = localParts(candidate, timezone);
    const day = `${parts.year}-${parts.month}-${parts.day}`;
    if (Number(parts.hour) === hour && Number(parts.minute) === minute && (!weekdays || weekdays.has(String(parts.weekday).toLowerCase())) && !(targetAlreadyReached && day === afterDay)) return candidate;
  }
  throw new Error("Scheduled trigger has no occurrence in the next eight days");
}

export function workflowLocalDay(date: Date, timezone: string) {
  const parts = localParts(date, timezone);
  return { key: `${parts.year}-${parts.month}-${parts.day}`, month: Number(parts.month), day: Number(parts.day) };
}
