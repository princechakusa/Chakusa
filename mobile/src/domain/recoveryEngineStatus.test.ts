import { describe, expect, it } from 'vitest';
import { recoveryEngineStatus } from './recoveryEngineStatus';

const base = { callDetection: 'ready' as const, hasContactsPermission: true, automationAvailability: 'available' as const, automationEnabled: true, pushGranted: true };

describe('recovery engine status', () => {
  it('is active once every applicable capability is on', () => {
    expect(recoveryEngineStatus(base).overall).toBe('active');
  });

  it('is attention when any applicable capability still needs the owner', () => {
    expect(recoveryEngineStatus({ ...base, pushGranted: false }).overall).toBe('attention');
    expect(recoveryEngineStatus({ ...base, automationEnabled: false }).overall).toBe('attention');
    expect(recoveryEngineStatus({ ...base, callDetection: 'needs_role' }).overall).toBe('attention');
  });

  it('excludes locked (plan-gated) automation from the pass/fail calculation entirely', () => {
    const result = recoveryEngineStatus({ ...base, automationAvailability: 'free-locked' });
    expect(result.items.find(item => item.key === 'followUp')?.status).toBe('locked');
    // Free-locked automation must never be the reason the engine reads "attention".
    expect(result.overall).toBe('active');
  });

  it('omits missed-call detection entirely when the platform does not support it (iOS/web)', () => {
    const result = recoveryEngineStatus({ ...base, callDetection: 'unsupported' });
    expect(result.items.some(item => item.key === 'detection')).toBe(false);
    expect(result.overall).toBe('active');
  });

  it('reports contact coverage separately from base detection once detection is ready', () => {
    const result = recoveryEngineStatus({ ...base, hasContactsPermission: false });
    const coverage = result.items.find(item => item.key === 'contactCoverage');
    expect(coverage?.status).toBe('attention');
    expect(coverage?.action).toBe('Turn on');
    expect(result.items.find(item => item.key === 'detection')?.status).toBe('active');
    expect(result.overall).toBe('attention');
  });

  it('omits contact coverage entirely when base detection is not ready or unsupported', () => {
    expect(recoveryEngineStatus({ ...base, callDetection: 'needs_role', hasContactsPermission: false }).items.some(item => item.key === 'contactCoverage')).toBe(false);
    expect(recoveryEngineStatus({ ...base, callDetection: 'unsupported', hasContactsPermission: false }).items.some(item => item.key === 'contactCoverage')).toBe(false);
  });

  it('never exposes technical permission/role language in business-facing copy', () => {
    const result = recoveryEngineStatus({ ...base, callDetection: 'needs_both', automationEnabled: false, pushGranted: false });
    const allCopy = result.items.map(item => item.value.toLowerCase()).join(' ');
    expect(allCopy).not.toMatch(/permission|role|read_phone_state|call_screening|api/);
  });

  it('still reads attention off notifications alone when detection and automation are both excluded', () => {
    // Notifications is always gradable on every platform/plan, so in
    // practice overall never actually settles on 'not_started' in this
    // app — it exists in the type for defensive completeness, not because
    // a reachable all-excluded state exists today.
    expect(recoveryEngineStatus({ callDetection: 'unsupported', hasContactsPermission: false, automationAvailability: 'service-unavailable', automationEnabled: false, pushGranted: false }).overall).toBe('attention');
  });
});
