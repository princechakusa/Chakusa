import { describe, expect, it } from 'vitest';
import { audienceCoachingDestination } from './coachingNavigation';

describe('Business Assistant coaching navigation', () => {
  it('opens the existing Customers tab with the recommended audience selected', () => {
    expect(audienceCoachingDestination('outstanding_payments')).toEqual({
      screen: 'Main',
      params: { screen: 'Customers', params: { audienceKey: 'outstanding_payments' } },
    });
  });
});
