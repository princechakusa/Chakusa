import { describe, expect, it } from 'vitest';
import type { SubscriptionStatusDto } from '../apiTypes';
import { trialDaysRemaining, trialProgressCopy } from './trialExperience';

const value = { recoveredRevenueThisMonth: 0, completedAppointmentsThisMonth: 1, scheduledAppointmentValue: 0, customerMessagesSentThisMonth: 2, reviewsReceivedThisMonth: 1 };
describe('trial experience', () => {
  it('calculates inclusive remaining days without going negative', () => { expect(trialDaysRemaining('2026-08-27T00:00:00Z', new Date('2026-08-24T12:00:00Z'))).toBe(3); expect(trialDaysRemaining('2026-08-20T00:00:00Z', new Date('2026-08-24T00:00:00Z'))).toBe(0); });
  it('uses recorded outcomes for trial progress', () => expect(trialProgressCopy({ status: 'TRIALING', trialEndsAt: '2026-08-25T00:00:00Z', value } as Pick<SubscriptionStatusDto, 'status'|'trialEndsAt'|'value'>, new Date('2026-08-24T00:00:00Z'))).toEqual({ title: '1 day left in your Pro trial', message: 'Chakusa has already recorded 4 customer results during this trial.' }));
  it('does not show trial copy outside trialing status', () => expect(trialProgressCopy({ status: 'ACTIVE', trialEndsAt: null, value } as Pick<SubscriptionStatusDto, 'status'|'trialEndsAt'|'value'>)).toBeNull());
});
