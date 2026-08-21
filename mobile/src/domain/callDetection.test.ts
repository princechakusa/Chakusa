import { describe, expect, it } from 'vitest';
import { callDetectionAvailability, isValidMissedCallEvent, partitionMissedCallEvents } from './callDetection';

const event = (overrides: Partial<{ clientEventId: string; phone: string; occurredAt: string }> = {}) => ({
  clientEventId: 'call-1',
  phone: '+263771234567',
  occurredAt: new Date().toISOString(),
  ...overrides,
});

describe('missed-call event validation', () => {
  it('accepts a well-formed event', () => expect(isValidMissedCallEvent(event())).toBe(true));
  it('rejects an empty clientEventId', () => expect(isValidMissedCallEvent(event({ clientEventId: '' }))).toBe(false));
  it('rejects an empty phone', () => expect(isValidMissedCallEvent(event({ phone: '' }))).toBe(false));
  it('rejects an unparseable timestamp', () => expect(isValidMissedCallEvent(event({ occurredAt: 'not-a-date' }))).toBe(false));

  it('partitions valid events for sync and invalid ones for immediate clearing', () => {
    const good = event({ clientEventId: 'good' });
    const bad = event({ clientEventId: 'bad', phone: '' });
    const result = partitionMissedCallEvents([good, bad]);
    expect(result.valid).toEqual([good]);
    expect(result.invalidIds).toEqual(['bad']);
  });

  it('partitions an empty list into two empty lists', () => {
    expect(partitionMissedCallEvents([])).toEqual({ valid: [], invalidIds: [] });
  });
});

describe('call detection availability', () => {
  it('is unsupported when the role itself is unsupported, regardless of permission', () => {
    expect(callDetectionAvailability('unsupported', true)).toBe('unsupported');
    expect(callDetectionAvailability('unsupported', false)).toBe('unsupported');
  });
  it('is ready only once both the role and the permission are granted', () => {
    expect(callDetectionAvailability('granted', true)).toBe('ready');
  });
  it('reports needs_role when only the role is missing', () => {
    expect(callDetectionAvailability('not_granted', true)).toBe('needs_role');
  });
  it('reports needs_phone_permission when only the permission is missing', () => {
    expect(callDetectionAvailability('granted', false)).toBe('needs_phone_permission');
  });
  it('reports needs_both when neither is granted', () => {
    expect(callDetectionAvailability('not_granted', false)).toBe('needs_both');
  });
});
