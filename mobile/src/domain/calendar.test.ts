import { describe, expect, it } from 'vitest';
import { combineLocalDateTime, localDateKey, weekDates } from './calendar';
describe('calendar dates', () => {
  it('returns a Monday-first seven-day week', () => { const week = weekDates(new Date(2026, 7, 26)); expect(week).toHaveLength(7); expect(week[0]?.getDay()).toBe(1); expect(week[6]?.getDay()).toBe(0); });
  it('formats local date keys', () => expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05'));
  it('rejects invalid local date/time input', () => expect(combineLocalDateTime('bad', 'time')).toBeNull());
});
