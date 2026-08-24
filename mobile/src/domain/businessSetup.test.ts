import { describe, expect, it } from 'vitest';
import { addService, parseWeeklyHours, serializeWeeklyHours } from './businessSetup';

describe('structured business setup', () => {
  it('normalizes missing and legacy working hours to a complete week', () => {
    const hours = parseWeeklyHours({ summary: 'Mon-Sat 9-5' });
    expect(Object.keys(hours)).toHaveLength(7);
    expect(hours.monday).toEqual({ enabled: true, opensAt: '09:00', closesAt: '17:00' });
    expect(hours.sunday.enabled).toBe(false);
  });
  it('preserves valid structured hours', () => {
    const hours = parseWeeklyHours({ days: { monday: { enabled: true, opensAt: '08:30', closesAt: '16:45' } } });
    expect(serializeWeeklyHours(hours).days.monday.opensAt).toBe('08:30');
  });
  it('adds trimmed unique services', () => {
    expect(addService(['Haircut'], ' haircut ')).toEqual(['Haircut']);
    expect(addService(['Haircut'], 'Color')).toEqual(['Haircut', 'Color']);
  });
});
