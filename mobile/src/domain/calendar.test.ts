import { describe, expect, it } from 'vitest';
import { combineLocalDateTime, layoutDayGrid, localDateKey, minutesOfDay, weekDates } from './calendar';
describe('calendar dates', () => {
  it('returns a Monday-first seven-day week', () => { const week = weekDates(new Date(2026, 7, 26)); expect(week).toHaveLength(7); expect(week[0]?.getDay()).toBe(1); expect(week[6]?.getDay()).toBe(0); });
  it('formats local date keys', () => expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05'));
  it('rejects invalid local date/time input', () => expect(combineLocalDateTime('bad', 'time')).toBeNull());
});

describe('minutesOfDay', () => {
  it('counts minutes since local midnight', () => expect(minutesOfDay(new Date(2026, 0, 5, 9, 30))).toBe(570));
  it('clamps to the day', () => expect(minutesOfDay(new Date(2026, 0, 5, 0, 0))).toBe(0));
});

describe('layoutDayGrid', () => {
  const at = (h: number, m = 0) => new Date(2026, 0, 5, h, m);
  const start = (e: { s: Date }) => e.s;
  const end = (e: { e: Date }) => e.e;

  it('keeps non-overlapping events in a single lane', () => {
    const blocks = layoutDayGrid([{ s: at(9), e: at(10) }, { s: at(11), e: at(12) }], start, end);
    expect(blocks.every(b => b.lanes === 1 && b.lane === 0)).toBe(true);
  });

  it('splits overlapping events into side-by-side lanes', () => {
    const blocks = layoutDayGrid([{ s: at(9), e: at(10, 30) }, { s: at(9, 30), e: at(11) }], start, end);
    expect(blocks).toHaveLength(2);
    expect(blocks.every(b => b.lanes === 2)).toBe(true);
    expect(new Set(blocks.map(b => b.lane))).toEqual(new Set([0, 1]));
  });

  it('enforces a minimum block height', () => {
    const [block] = layoutDayGrid([{ s: at(9), e: at(9, 5) }], start, end, 20);
    expect(block.endMinute - block.startMinute).toBe(20);
  });

  it('reuses a freed lane after an earlier event ends', () => {
    const blocks = layoutDayGrid(
      [{ s: at(9), e: at(10) }, { s: at(9, 15), e: at(11) }, { s: at(10, 15), e: at(11) }],
      start,
      end,
    );
    const third = blocks.find(b => b.startMinute === minutesOfDay(at(10, 15)));
    expect(third?.lane).toBe(0);
  });
});
