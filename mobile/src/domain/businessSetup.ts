export const BUSINESS_DAYS = [
  ['monday', 'Monday'], ['tuesday', 'Tuesday'], ['wednesday', 'Wednesday'], ['thursday', 'Thursday'],
  ['friday', 'Friday'], ['saturday', 'Saturday'], ['sunday', 'Sunday'],
] as const;

export type BusinessDay = typeof BUSINESS_DAYS[number][0];
export interface DayHours { enabled: boolean; opensAt: string; closesAt: string; }
export type WeeklyHours = Record<BusinessDay, DayHours>;

export const DEFAULT_WEEKLY_HOURS: WeeklyHours = Object.fromEntries(BUSINESS_DAYS.map(([day]) => [day, {
  enabled: day !== 'sunday', opensAt: '09:00', closesAt: '17:00',
}])) as WeeklyHours;

const validTime = (value: unknown) => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function parseWeeklyHours(value: Record<string, unknown> | null | undefined): WeeklyHours {
  const source = value?.days && typeof value.days === 'object' && !Array.isArray(value.days) ? value.days as Record<string, unknown> : {};
  return Object.fromEntries(BUSINESS_DAYS.map(([day]) => {
    const entry = source[day] && typeof source[day] === 'object' && !Array.isArray(source[day]) ? source[day] as Record<string, unknown> : {};
    const fallback = DEFAULT_WEEKLY_HOURS[day];
    return [day, { enabled: typeof entry.enabled === 'boolean' ? entry.enabled : fallback.enabled, opensAt: validTime(entry.opensAt) ? entry.opensAt as string : fallback.opensAt, closesAt: validTime(entry.closesAt) ? entry.closesAt as string : fallback.closesAt }];
  })) as WeeklyHours;
}

export const serializeWeeklyHours = (hours: WeeklyHours) => ({ version: 1, days: hours });

export function addService(services: string[], candidate: string) {
  const normalized = candidate.trim();
  if (!normalized || services.some(service => service.toLocaleLowerCase() === normalized.toLocaleLowerCase())) return services;
  return [...services, normalized];
}
