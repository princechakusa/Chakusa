export interface DelaySpec { amount: number; unit: "seconds" | "minutes" | "hours" | "days" | "weeks" | "months" | "business_days" | "business_hours"; timezone?: string; workingHours?: Record<string, { start: string; end: string } | null>; holidays?: string[]; }
import { isWithinBusinessHours } from "./conditionEngine.js";
const fixed = { seconds: 1e3, minutes: 6e4, hours: 36e5, days: 864e5, weeks: 6048e5 } as const;
function localWeekday(date: Date, timezone: string) { return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(date).toLowerCase(); }
export function delayUntil(from: Date, delay: DelaySpec) {
  if (!Number.isFinite(delay.amount) || delay.amount <= 0) throw new Error("Delay amount must be positive");
  if (["months", "business_days"].includes(delay.unit) && !Number.isInteger(delay.amount)) throw new Error(`${delay.unit} delay must use a whole number`);
  if (delay.unit in fixed) return new Date(from.getTime() + delay.amount * fixed[delay.unit as keyof typeof fixed]);
  if (delay.unit === "months") { const result = new Date(from); result.setUTCMonth(result.getUTCMonth() + delay.amount); return result; }
  const timezone = delay.timezone ?? "UTC"; const working = delay.workingHours ?? { mon: { start: "09:00", end: "17:00" }, tue: { start: "09:00", end: "17:00" }, wed: { start: "09:00", end: "17:00" }, thu: { start: "09:00", end: "17:00" }, fri: { start: "09:00", end: "17:00" } };
  if (!Object.values(working).some((window) => Boolean(window && /^([01]\d|2[0-3]):[0-5]\d$/.test(window.start) && /^([01]\d|2[0-3]):[0-5]\d$/.test(window.end)))) throw new Error("Business delay requires at least one valid working day");
  const holidays = delay.holidays ?? []; let result = new Date(from); let remaining = delay.amount; let guard = 0;
  if (delay.unit === "business_days") {
    let previousDay = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(result);
    const wallTime = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(result);
    while (remaining > 0) { result = new Date(result.getTime() + 60_000); const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(result); if (day !== previousDay) { previousDay = day; if (working[localWeekday(result, timezone)] && !holidays.includes(day)) remaining -= 1; } if (++guard > 2_630_000) throw new Error("Business-day delay exceeds scheduling horizon"); }
    while (new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(result) < wallTime) { result = new Date(result.getTime() + 60_000); if (++guard > 2_631_560) throw new Error("Unable to resolve business-day wall time"); }
    return result;
  }
  let remainingMinutes = Math.round(remaining * 60);
  while (remainingMinutes > 0) { result = new Date(result.getTime() + 60_000); if (isWithinBusinessHours(result, timezone, working, holidays)) remainingMinutes -= 1; if (++guard > 2_630_000) throw new Error("Business-hour delay exceeds scheduling horizon"); }
  return result;
}
