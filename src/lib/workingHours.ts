export const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type Weekday = typeof WEEKDAYS[number];
export interface DayHours { enabled: boolean; opensAt: string; closesAt: string }
export type WeeklyHours = Record<Weekday, DayHours>;

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DEFAULT_WORKING_HOURS = Object.fromEntries(WEEKDAYS.map(day => [day, { enabled: day !== "sunday", opensAt: "09:00", closesAt: "17:00" }])) as WeeklyHours;

export function parseWorkingHours(value: unknown): WeeklyHours {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const days = record.days && typeof record.days === "object" && !Array.isArray(record.days) ? record.days as Record<string, unknown> : {};
  return Object.fromEntries(WEEKDAYS.map(day => {
    const source = days[day] && typeof days[day] === "object" && !Array.isArray(days[day]) ? days[day] as Record<string, unknown> : {};
    const fallback = DEFAULT_WORKING_HOURS[day];
    return [day, { enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled, opensAt: typeof source.opensAt === "string" && timePattern.test(source.opensAt) ? source.opensAt : fallback.opensAt, closesAt: typeof source.closesAt === "string" && timePattern.test(source.closesAt) ? source.closesAt : fallback.closesAt }];
  })) as WeeklyHours;
}

export const minutesOfDay = (value: string) => { const [hours = 0, minutes = 0] = value.split(":").map(Number); return hours * 60 + minutes; };

export function zonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? "";
  return { date: `${read("year")}-${read("month")}-${read("day")}`, weekday: read("weekday").toLowerCase() as Weekday, minute: Number(read("hour")) * 60 + Number(read("minute")) };
}

export function fitsWorkingHours(startsAt: Date, endsAt: Date, timezone: string, hours: WeeklyHours) {
  const start = zonedParts(startsAt, timezone); const end = zonedParts(endsAt, timezone); const day = hours[start.weekday];
  return Boolean(day?.enabled && start.date === end.date && start.minute >= minutesOfDay(day.opensAt) && end.minute <= minutesOfDay(day.closesAt));
}
