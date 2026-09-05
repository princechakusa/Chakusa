import { describe, expect, it } from 'vitest';
import {
  capabilityStatusCopy,
  FUTURE_CAPABILITIES,
  isCapabilityUnlocked,
  lockedCapabilities,
} from './futureCapabilities';

const allLocked = {
  aiReceptionist: false, quotesEstimates: false, invoicing: false, marketplaceDiscovery: false, accountingIntegrations: false,
};
const allUnlocked = {
  aiReceptionist: true, quotesEstimates: true, invoicing: true, marketplaceDiscovery: true, accountingIntegrations: true,
};

describe('isCapabilityUnlocked', () => {
  it('reflects the real snapshot value', () => {
    expect(isCapabilityUnlocked(allLocked, 'aiReceptionist')).toBe(false);
    expect(isCapabilityUnlocked(allUnlocked, 'aiReceptionist')).toBe(true);
  });
});

describe('capabilityStatusCopy', () => {
  it('never claims a locked capability is included', () => {
    expect(capabilityStatusCopy(allLocked, 'invoicing')).toBe('Not yet available — coming to Chakusa');
  });

  it('reports an unlocked capability as included', () => {
    expect(capabilityStatusCopy(allUnlocked, 'invoicing')).toBe('Included on your plan');
  });
});

describe('lockedCapabilities', () => {
  it('lists every capability when none are unlocked', () => {
    expect(lockedCapabilities(allLocked)).toHaveLength(FUTURE_CAPABILITIES.length);
  });

  it('lists nothing when all are unlocked', () => {
    expect(lockedCapabilities(allUnlocked)).toEqual([]);
  });

  it('lists only the locked ones for a mixed snapshot', () => {
    const mixed = { ...allLocked, invoicing: true };
    const result = lockedCapabilities(mixed);
    expect(result.map((c) => c.key)).not.toContain('invoicing');
    expect(result).toHaveLength(FUTURE_CAPABILITIES.length - 1);
  });
});
