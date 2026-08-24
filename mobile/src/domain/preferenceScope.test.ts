import { describe, expect, it } from 'vitest';

import { preferenceStorageKey, scopedPreferenceState } from './preferenceScope';

const saved = {
  onboardingStep: 8,
  onboardingComplete: true,
  goals: [],
  industry: '',
  teamSize: null,
  attention: { missedCalls: true, reviews: true, comebacks: true, businessActivity: true },
};

describe('account-scoped preferences', () => {
  it('uses separate keys for anonymous and authenticated owners', () => {
    expect(preferenceStorageKey(null)).not.toBe(preferenceStorageKey('owner-1'));
    expect(preferenceStorageKey('owner-1')).not.toBe(preferenceStorageKey('owner-2'));
  });

  it('overrides stale local completion with incomplete server business state', () => {
    expect(scopedPreferenceState(saved, 'new-google-owner', false, 'salon')).toMatchObject({ onboardingComplete: false, onboardingStep: 8, industry: 'salon' });
  });

  it('routes a completed server business past setup regardless of a stale draft', () => {
    expect(scopedPreferenceState({ ...saved, onboardingStep: 4, onboardingComplete: false }, 'existing-owner', true)).toMatchObject({ onboardingComplete: true, onboardingStep: 0 });
  });
});
