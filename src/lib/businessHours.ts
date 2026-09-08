import { WEEKDAYS, minutesOfDay, parseWorkingHours, zonedParts, type Weekday, type WeeklyHours } from "./workingHours.js";

// #16 After-hours AI — deterministic "is the business open right now, and when
// does it open next" from the authoritative schedule (Business.timezone +
// Business.workingHours + business-wide closed ranges). No I/O, no reliance on
// device time. The language model never computes any of this.

export type BusinessHoursReason = "open" | "before_open" | "after_close" | "closed_day" | "blocked" | "unresolved";

export interface NextOpen {
  /** UTC instant of the next opening (2-pass tz conversion, DST-safe). */
  atIso: string;
  /** Local calendar date in the business timezone, YYYY-MM-DD. */
  localDate: string;
  /** Local opening time, HH:MM. */
  localTime: string;
  weekday: Weekday;
  /** Server-rendered phrase for the model context: "later today at 2:00 PM", "tomorrow at 9:00 AM", "Monday at 8:00 AM". */
  label: string;
}

export interface BusinessHoursState {
  resolved: boolean;
  open: boolean;
  reason: BusinessHoursReason;
  timezone: string;
  /** Current local time in the business timezone, HH:MM. */
  localTime: string;
  weekday: Weekday;
  nextOpen: NextOpen | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;

function isValidZone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

function tzOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(instant);
  const g = (t: string) => Number(parts.find(p => p.type === t)?.value ?? "0");
  const asUTC = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUTC - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Wall-clock (local date + HH:MM in tz) -> UTC instant, DST-safe via two passes. */
function wallToUtc(y: number, mo: number, d: number, minute: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, Math.floor(minute / 60), minute % 60);
  const t1 = guess - tzOffsetMs(new Date(guess), tz);
  const t2 = guess - tzOffsetMs(new Date(t1), tz);
  return new Date(t2);
}

const isOvernight = (opensAt: string, closesAt: string) => minutesOfDay(closesAt) <= minutesOfDay(opensAt);

function rangesCover(instant: Date, ranges: ReadonlyArray<{ start: Date; end: Date }> | undefined): boolean {
  return !!ranges?.some(r => r.start.getTime() <= instant.getTime() && r.end.getTime() > instant.getTime());
}

function relativeLabel(fromLocalDate: string, targetLocalDate: string, targetLocalTime: string, weekday: Weekday, sameDay: boolean): string {
  const time12 = (() => {
    const [h, m] = targetLocalTime.split(":").map(Number);
    const ampm = h! < 12 ? "AM" : "PM";
    const hr = h! % 12 === 0 ? 12 : h! % 12;
    return `${hr}:${pad(m!)} ${ampm}`;
  })();
  if (sameDay) return `later today at ${time12}`;
  const from = new Date(`${fromLocalDate}T00:00:00Z`).getTime();
  const to = new Date(`${targetLocalDate}T00:00:00Z`).getTime();
  const days = Math.round((to - from) / 86_400_000);
  if (days === 1) return `tomorrow at ${time12}`;
  const name = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  return `${name} at ${time12}`;
}

export function resolveBusinessHours(input: {
  timezone: string | null | undefined;
  workingHours: unknown;
  now?: Date;
  /** Business-wide closed windows (e.g. holiday booking blocks) that make the business unavailable regardless of weekly hours. */
  closedRanges?: ReadonlyArray<{ start: Date; end: Date }>;
}): BusinessHoursState {
  const now = input.now ?? new Date();
  const tz = (input.timezone ?? "").trim();
  if (!tz || !isValidZone(tz)) {
    return { resolved: false, open: false, reason: "unresolved", timezone: tz || "UTC", localTime: "00:00", weekday: "sunday", nextOpen: null };
  }
  const hours: WeeklyHours = parseWorkingHours(input.workingHours);
  const nowParts = zonedParts(now, tz);
  const localTime = hhmm(nowParts.minute);

  // A business-wide closed range covering "now" beats the weekly schedule.
  const blockedNow = rangesCover(now, input.closedRanges);

  const today = hours[nowParts.weekday];
  const yesterdayName = WEEKDAYS[(WEEKDAYS.indexOf(nowParts.weekday) + 6) % 7]!;
  const yesterday = hours[yesterdayName];

  let open = false;
  let reason: BusinessHoursReason = "closed_day";
  if (blockedNow) {
    open = false;
    reason = "blocked";
  } else if (today.enabled) {
    const openMin = minutesOfDay(today.opensAt);
    const closeMin = minutesOfDay(today.closesAt);
    if (isOvernight(today.opensAt, today.closesAt)) {
      open = nowParts.minute >= openMin; // window runs opensAt -> 24:00 today
      reason = open ? "open" : "before_open";
    } else {
      if (nowParts.minute < openMin) { open = false; reason = "before_open"; }
      else if (nowParts.minute >= closeMin) { open = false; reason = "after_close"; }
      else { open = true; reason = "open"; }
    }
  } else {
    open = false;
    reason = "closed_day";
  }
  // Overnight continuation from the previous day: e.g. yesterday 20:00-02:00.
  if (!open && !blockedNow && yesterday.enabled && isOvernight(yesterday.opensAt, yesterday.closesAt) && nowParts.minute < minutesOfDay(yesterday.closesAt)) {
    open = true;
    reason = "open";
  }

  return {
    resolved: true,
    open,
    reason,
    timezone: tz,
    localTime,
    weekday: nowParts.weekday,
    nextOpen: open ? null : computeNextOpen(now, tz, hours, nowParts, input.closedRanges),
  };
}

function computeNextOpen(
  now: Date,
  tz: string,
  hours: WeeklyHours,
  nowParts: { date: string; weekday: Weekday; minute: number },
  closedRanges: ReadonlyArray<{ start: Date; end: Date }> | undefined,
): NextOpen | null {
  const [y0, m0, d0] = nowParts.date.split("-").map(Number);
  for (let offset = 0; offset <= 14; offset += 1) {
    // The local calendar date `offset` days from today.
    const probe = new Date(Date.UTC(y0!, m0! - 1, d0! + offset, 12, 0, 0));
    const parts = zonedParts(probe, tz);
    const day = hours[parts.weekday];
    if (!day.enabled) continue;
    const openMin = minutesOfDay(day.opensAt);
    if (offset === 0 && nowParts.minute >= openMin) continue; // already past today's opening
    const [py, pm, pd] = parts.date.split("-").map(Number);
    const atUtc = wallToUtc(py!, pm!, pd!, openMin, tz);
    if (atUtc.getTime() <= now.getTime()) continue;
    if (rangesCover(atUtc, closedRanges)) continue; // opening instant falls inside a closed window
    return {
      atIso: atUtc.toISOString(),
      localDate: parts.date,
      localTime: day.opensAt,
      weekday: parts.weekday,
      label: relativeLabel(nowParts.date, parts.date, day.opensAt, parts.weekday, offset === 0),
    };
  }
  return null;
}
