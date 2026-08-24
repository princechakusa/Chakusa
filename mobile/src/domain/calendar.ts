const pad = (value: number) => String(value).padStart(2, '0');
export const localDateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const localTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
export function startOfDay(date: Date) { const value = new Date(date); value.setHours(0, 0, 0, 0); return value; }
export function endOfDay(date: Date) { const value = startOfDay(date); value.setDate(value.getDate() + 1); return value; }
export function weekDates(anchor: Date) { const start = startOfDay(anchor); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); return Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date; }); }
export function combineLocalDateTime(date: string, time: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null; const value = new Date(`${date}T${time}:00`); return Number.isNaN(value.getTime()) ? null : value.toISOString(); }
