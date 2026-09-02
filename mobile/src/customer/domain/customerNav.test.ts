import { describe, expect, it } from 'vitest';
import {
  canNavigateCustomer,
  isBusinessOnlyRoute,
  isSafeCustomerDeepLink,
  parseCustomerDeepLink,
} from './customerNav';

describe('isBusinessOnlyRoute', () => {
  it('flags business-owner destinations', () => {
    for (const route of ['Dashboard', 'Leads', 'Customers', 'Settings', 'LoyaltyManagement', 'ServiceCatalog', 'TeamInvite', 'AutomationRules']) {
      expect(isBusinessOnlyRoute(route)).toBe(true);
    }
  });

  it('does not flag customer destinations', () => {
    for (const route of ['CustomerHome', 'BusinessProfile', 'BookingFlow', 'CustomerRewards', 'CustomerAssistant']) {
      expect(isBusinessOnlyRoute(route)).toBe(false);
    }
  });
});

describe('canNavigateCustomer', () => {
  it('accepts known customer routes', () => {
    expect(canNavigateCustomer('CustomerHome')).toBe(true);
    expect(canNavigateCustomer('BookingDetail')).toBe(true);
  });

  it('rejects unknown routes and business routes', () => {
    expect(canNavigateCustomer('Dashboard')).toBe(false);
    expect(canNavigateCustomer('SomethingElse')).toBe(false);
    expect(canNavigateCustomer('LoyaltyMembers')).toBe(false);
  });
});

describe('parseCustomerDeepLink', () => {
  it('parses a business profile link', () => {
    expect(parseCustomerDeepLink('chakusa://business/glow-studio')).toEqual({ route: 'BusinessProfile', params: { slug: 'glow-studio' } });
    expect(parseCustomerDeepLink('chakusa://businesses/glow-studio/')).toEqual({ route: 'BusinessProfile', params: { slug: 'glow-studio' } });
  });

  it('distinguishes starting a booking from opening one', () => {
    expect(parseCustomerDeepLink('chakusa://book/glow-studio')).toEqual({ route: 'BookingFlow', params: { slug: 'glow-studio' } });
    expect(parseCustomerDeepLink('chakusa://booking/abc123')).toEqual({ route: 'BookingDetail', params: { bookingId: 'abc123' } });
    expect(parseCustomerDeepLink('chakusa://bookings/abc123')).toEqual({ route: 'BookingDetail', params: { bookingId: 'abc123' } });
  });

  it('parses assistant links with and without a conversation id', () => {
    expect(parseCustomerDeepLink('chakusa://assistant')).toEqual({ route: 'CustomerAssistant', params: {} });
    expect(parseCustomerDeepLink('chakusa://ai/conv-9')).toEqual({ route: 'CustomerAssistant', params: { conversationId: 'conv-9' } });
  });

  it('parses notifications and rewards', () => {
    expect(parseCustomerDeepLink('chakusa://notifications')).toEqual({ route: 'CustomerNotifications', params: {} });
    expect(parseCustomerDeepLink('chakusa://my-rewards')).toEqual({ route: 'CustomerRewards', params: {} });
  });

  it('handles https links and query strings', () => {
    expect(parseCustomerDeepLink('https://app.chakusa.com/business/glow-studio?ref=email')).toEqual({ route: 'BusinessProfile', params: { slug: 'glow-studio' } });
  });

  it('refuses business-owner deep links', () => {
    expect(parseCustomerDeepLink('chakusa://dashboard')).toBeNull();
    expect(parseCustomerDeepLink('chakusa://team-invite/token123')).toBeNull();
    expect(parseCustomerDeepLink('chakusa://reset-password')).toBeNull();
  });

  it('returns null for empty or unusable input', () => {
    expect(parseCustomerDeepLink('')).toBeNull();
    expect(parseCustomerDeepLink('chakusa://')).toBeNull();
    expect(parseCustomerDeepLink('chakusa://business')).toBeNull();
  });
});

describe('parseCustomerDeepLink — loyalty (Loop 8)', () => {
  it('parses loyalty destinations', () => {
    expect(parseCustomerDeepLink('chakusa://loyalty/biz-123')).toEqual({ route: 'CustomerLoyaltyBusiness', params: { businessId: 'biz-123' } });
    expect(parseCustomerDeepLink('chakusa://loyalty')).toEqual({ route: 'CustomerRewards', params: {} });
    expect(parseCustomerDeepLink('chakusa://redemptions')).toEqual({ route: 'CustomerRedemptions', params: {} });
    expect(parseCustomerDeepLink('chakusa://memberships')).toEqual({ route: 'CustomerMemberships', params: {} });
    expect(parseCustomerDeepLink('chakusa://referrals')).toEqual({ route: 'CustomerReferrals', params: {} });
  });

  it('still refuses business loyalty-management deep links', () => {
    expect(parseCustomerDeepLink('chakusa://loyalty-management')).toBeNull();
    expect(parseCustomerDeepLink('chakusa://loyalty-members')).toBeNull();
    expect(isBusinessOnlyRoute('LoyaltyManagement')).toBe(true);
    expect(isBusinessOnlyRoute('LoyaltyMembers')).toBe(true);
    expect(canNavigateCustomer('LoyaltyRewards')).toBe(false);
  });

  it('keeps the new customer loyalty routes navigable', () => {
    for (const route of ['CustomerLoyaltyBusiness', 'CustomerRewardDetail', 'CustomerRedemptions', 'CustomerMemberships', 'CustomerReferrals']) {
      expect(canNavigateCustomer(route)).toBe(true);
      expect(isBusinessOnlyRoute(route)).toBe(false);
    }
  });
});

describe('isSafeCustomerDeepLink', () => {
  it('is true only for links that stay inside the customer app', () => {
    expect(isSafeCustomerDeepLink('chakusa://business/glow-studio')).toBe(true);
    expect(isSafeCustomerDeepLink('chakusa://dashboard')).toBe(false);
    expect(isSafeCustomerDeepLink('garbage')).toBe(false);
  });
});
