import { describe, expect, it } from 'vitest';
import { computeSetupScore, SetupScoreBusiness } from './setupScore';

const fullBusiness: SetupScoreBusiness = {
  name: 'Safi Salon', industry: 'salon', phone: '+263771234567', country: 'ZW',
  googleReviewLink: 'https://g.page/r/safi', workingHours: { summary: 'Mon-Sat, 9-6' }, defaultServices: ['Haircut'],
};
const emptyBusiness: SetupScoreBusiness = { name: '', industry: null, phone: null, country: null, googleReviewLink: null, workingHours: null, defaultServices: [] };

describe('setup score', () => {
  it('scores a fully-configured Pro business at 100%, including automation', () => {
    const result = computeSetupScore({ business: fullBusiness, automationAvailability: 'available', automationConfigured: true, pushEnabled: true });
    expect(result.score).toBe(100);
    expect(result.total).toBe(9);
    expect(result.checklist.find(item => item.key === 'automation')?.complete).toBe(true);
  });

  it('excludes automation from the checklist entirely when the plan gates it, so Free can still reach 100%', () => {
    const result = computeSetupScore({ business: fullBusiness, automationAvailability: 'free-locked', automationConfigured: false, pushEnabled: true });
    expect(result.total).toBe(8);
    expect(result.checklist.some(item => item.key === 'automation')).toBe(false);
    expect(result.score).toBe(100);
  });

  it('scores a blank business at 0% with every item incomplete', () => {
    const result = computeSetupScore({ business: emptyBusiness, automationAvailability: 'free-locked', automationConfigured: false, pushEnabled: false });
    expect(result.score).toBe(0);
    expect(result.complete).toBe(0);
    expect(result.checklist.every(item => !item.complete)).toBe(true);
  });

  it('treats a missing business as fully incomplete rather than throwing', () => {
    const result = computeSetupScore({ business: null, automationAvailability: 'loading', automationConfigured: false, pushEnabled: false });
    expect(result.score).toBe(0);
    expect(result.total).toBe(8);
  });

  it('rounds partial completion to the nearest percent', () => {
    const result = computeSetupScore({ business: { ...emptyBusiness, name: 'Safi Salon' }, automationAvailability: 'subscription-unavailable', automationConfigured: false, pushEnabled: false });
    expect(result.complete).toBe(1);
    expect(result.total).toBe(8);
    expect(result.score).toBe(13);
  });

  it.each(['free-locked', 'subscription-unavailable', 'service-unavailable', 'loading'] as const)('excludes automation from the checklist for every non-available state (%s)', availability => {
    const result = computeSetupScore({ business: fullBusiness, automationAvailability: availability, automationConfigured: false, pushEnabled: true });
    expect(result.checklist.some(item => item.key === 'automation')).toBe(false);
  });
  it('includes automation only when the plan can actually use it', () => {
    const result = computeSetupScore({ business: fullBusiness, automationAvailability: 'available', automationConfigured: false, pushEnabled: true });
    expect(result.checklist.some(item => item.key === 'automation')).toBe(true);
  });
});
