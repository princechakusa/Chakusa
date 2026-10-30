import { describe, expect, it } from 'vitest';
import type { PlanDescriptionDto } from '../apiTypes';
import { planButtonLabel, planHighlights, referencePrice, renewalTerms, trialLabel } from './planCatalog';

const starter: PlanDescriptionDto = { plan: 'STARTER', rank: 1, referenceMonthlyPrice: 3, trialDays: 7, limits: { leadsPerMonth: 150, reviewRequestsPerMonth: 150, customers: 1000, openReminders: 150, customTemplatesPerType: 3, staffSeats: 1 }, features: [{ key: 'EXTENDED_HISTORY', label: 'Extended activity history' }] };
const business: PlanDescriptionDto = { plan: 'BUSINESS', rank: 3, referenceMonthlyPrice: 13, trialDays: 0, limits: { leadsPerMonth: null, reviewRequestsPerMonth: null, customers: null, openReminders: null, customTemplatesPerType: null, staffSeats: 10 }, features: [{ key: 'AUTOMATION', label: 'Automation' }, { key: 'UNLIMITED_TEMPLATES', label: 'Unlimited custom templates' }, { key: 'TEAM_MANAGEMENT', label: 'Team management' }] };

describe('plan presentation', () => {
  it('turns the API limits and features into readable lines', () => {
    expect(planHighlights(starter)).toEqual(['150 leads a month', '1,000 customers', '150 review requests a month', '150 open reminders', '3 custom message templates per type', 'Extended activity history']);
    const lines = planHighlights(business);
    expect(lines).toContain('Unlimited leads');
    expect(lines).toContain('Up to 10 team members with roles');
    expect(lines).toContain('Automation');
    expect(lines).not.toContain('Unlimited custom templates');
  });

  it('labels the trial from configuration, else the store offer', () => {
    expect(trialLabel(null, 7)).toBe('7-day free trial');
    expect(trialLabel('$0.99', 0)).toBe('Intro offer: $0.99');
    expect(trialLabel(null, 0)).toBeNull();
  });

  it('names the price charged after the trial when it is known', () => {
    expect(trialLabel(null, 7, '$3.00')).toBe('7-day free trial, then $3.00 / month');
    expect(trialLabel('$0.99', 0, '$8.00')).toBe('Intro offer: $0.99, then $8.00 / month');
  });

  it('states renewal, cancellation and who charges', () => {
    const ios = renewalTerms('ios');
    expect(ios).toMatch(/Apple Account/);
    expect(ios).toMatch(/renew automatically/);
    expect(ios).toMatch(/24 hours before the end of the current period/);
    expect(ios).toMatch(/cancel anytime in your App Store/);
    expect(renewalTerms('android')).toMatch(/Google Play account/);
  });

  it('names each button after what it does', () => {
    expect(planButtonLabel('subscribe', 'Starter', 7)).toBe('Start 7-day free trial');
    expect(planButtonLabel('subscribe', 'Pro', 0)).toBe('Subscribe to Pro');
    expect(planButtonLabel('upgrade', 'Business', 0)).toBe('Upgrade to Business');
    expect(planButtonLabel('downgrade', 'Starter', 0)).toBe('Switch to Starter');
    expect(planButtonLabel('current', 'Pro', 0)).toBe('Your current plan');
  });

  it('formats the configured reference price, and hides a missing one', () => {
    expect(referencePrice(3, 'USD')).toBe('$3');
    expect(referencePrice(7.99, 'USD')).toBe('$7.99');
    expect(referencePrice(0, 'USD')).toBeNull();
    expect(referencePrice(8, 'NOPE')).toBe('NOPE 8');
  });
});
