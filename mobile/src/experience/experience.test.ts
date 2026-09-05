import { describe, expect, it } from 'vitest';
import {
  classifyDeepLinkExperience,
  classifyNotificationExperience,
  coerceExperiencePreference,
  hasSessionFor,
  resolveInitialExperience,
  shouldStartExperienceSwitch,
} from './experience';

describe('coerceExperiencePreference', () => {
  it('accepts the two valid values, everything else is unselected', () => {
    expect(coerceExperiencePreference('customer')).toBe('customer');
    expect(coerceExperiencePreference('business')).toBe('business');
    expect(coerceExperiencePreference('BUSINESS')).toBe('business');
    expect(coerceExperiencePreference(null)).toBe('unselected');
    expect(coerceExperiencePreference('')).toBe('unselected');
    expect(coerceExperiencePreference('{corrupt')).toBe('unselected');
    expect(coerceExperiencePreference('admin')).toBe('unselected');
  });
});

describe('resolveInitialExperience', () => {
  const base = { preference: 'unselected' as const, hasBusinessSession: false, hasCustomerSession: false };

  it('shows the selector on a genuine first install', () => {
    expect(resolveInitialExperience(base)).toBe('unselected');
  });

  it('migrates an existing business user (business session, no preference) to business — never the selector', () => {
    expect(resolveInitialExperience({ ...base, hasBusinessSession: true })).toBe('business');
  });

  it('sends a customer-only device to the customer experience', () => {
    expect(resolveInitialExperience({ ...base, hasCustomerSession: true })).toBe('customer');
  });

  it('honours the saved preference over session heuristics', () => {
    expect(resolveInitialExperience({ preference: 'customer', hasBusinessSession: true, hasCustomerSession: true })).toBe('customer');
    expect(resolveInitialExperience({ preference: 'business', hasBusinessSession: true, hasCustomerSession: true })).toBe('business');
  });

  it('shows the selector when both sessions exist and there is no preference', () => {
    expect(resolveInitialExperience({ ...base, hasBusinessSession: true, hasCustomerSession: true })).toBe('unselected');
  });

  it('lets a trusted deep link win over the saved preference', () => {
    expect(resolveInitialExperience({ preference: 'business', hasBusinessSession: true, hasCustomerSession: false, deepLinkExperience: 'customer' })).toBe('customer');
  });

  it('lets the dev forced override win over everything', () => {
    expect(resolveInitialExperience({ preference: 'customer', hasBusinessSession: true, hasCustomerSession: true, deepLinkExperience: 'customer', forced: 'business' })).toBe('business');
  });

  it('still resolves a preference even when that session is missing (auth screen then shows)', () => {
    expect(resolveInitialExperience({ preference: 'customer', hasBusinessSession: true, hasCustomerSession: false })).toBe('customer');
    expect(resolveInitialExperience({ preference: 'business', hasBusinessSession: false, hasCustomerSession: true })).toBe('business');
  });
});

describe('hasSessionFor', () => {
  it('reads the right session flag', () => {
    expect(hasSessionFor('business', { hasBusinessSession: true, hasCustomerSession: false })).toBe(true);
    expect(hasSessionFor('customer', { hasBusinessSession: true, hasCustomerSession: false })).toBe(false);
  });
});

describe('classifyDeepLinkExperience', () => {
  it('classifies customer links via the Loop 7/8 parser', () => {
    expect(classifyDeepLinkExperience('chakusa://business/glow-studio')).toBe('customer');
    expect(classifyDeepLinkExperience('chakusa://book/glow-studio')).toBe('customer');
    expect(classifyDeepLinkExperience('chakusa://loyalty/biz-1')).toBe('customer');
    expect(classifyDeepLinkExperience('chakusa://my-rewards')).toBe('customer');
  });

  it('classifies known business links from the allowlist', () => {
    expect(classifyDeepLinkExperience('chakusa://reset-password')).toBe('business');
    expect(classifyDeepLinkExperience('chakusa://team-invite/tok123')).toBe('business');
    expect(classifyDeepLinkExperience('chakusa://dashboard')).toBe('business');
  });

  it('returns null for unknown, malformed or empty links — the router does not switch', () => {
    expect(classifyDeepLinkExperience('chakusa://')).toBeNull();
    expect(classifyDeepLinkExperience('garbage')).toBeNull();
    expect(classifyDeepLinkExperience('')).toBeNull();
    expect(classifyDeepLinkExperience(null)).toBeNull();
    expect(classifyDeepLinkExperience('chakusa://totally-unknown/thing')).toBeNull();
  });
});

describe('shouldStartExperienceSwitch — Android Fabric crash re-entrancy guard', () => {
  it('allows a switch to a different experience when nothing is in flight', () => {
    expect(shouldStartExperienceSwitch('business', 'customer', false)).toBe(true);
    expect(shouldStartExperienceSwitch('customer', 'unselected', false)).toBe(true);
  });

  it('rejects a switch while one is already in progress (rapid double-tap)', () => {
    expect(shouldStartExperienceSwitch('business', 'customer', true)).toBe(false);
    expect(shouldStartExperienceSwitch('customer', 'business', true)).toBe(false);
  });

  it('rejects a redundant switch to the experience already active', () => {
    expect(shouldStartExperienceSwitch('business', 'business', false)).toBe(false);
    expect(shouldStartExperienceSwitch('customer', 'customer', false)).toBe(false);
  });
});

describe('classifyNotificationExperience', () => {
  it('uses an explicit data.experience when valid', () => {
    expect(classifyNotificationExperience({ experience: 'business' })).toBe('business');
    expect(classifyNotificationExperience({ experience: 'customer' })).toBe('customer');
    expect(classifyNotificationExperience({ experience: 'nonsense' })).toBeNull();
  });

  it('maps known customer categories to customer', () => {
    expect(classifyNotificationExperience({ category: 'loyalty' })).toBe('customer');
    expect(classifyNotificationExperience({ category: 'booking_update' })).toBe('customer');
    expect(classifyNotificationExperience({ category: 'appointment_reminder' })).toBe('customer');
  });

  it('returns null when there is nothing safe to classify on', () => {
    expect(classifyNotificationExperience(null)).toBeNull();
    expect(classifyNotificationExperience({})).toBeNull();
    expect(classifyNotificationExperience({ category: 'lead_created' })).toBeNull();
  });
});
