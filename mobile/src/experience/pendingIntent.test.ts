import { describe, expect, it } from 'vitest';
import {
  normalizeDeepLinkIntent,
  normalizeNotificationIntent,
  parsePendingIntent,
  PENDING_INTENT_TTL_MS,
  serializePendingIntent,
} from './pendingIntent';

const NOW = 1_760_000_000_000;

describe('normalizeDeepLinkIntent', () => {
  it('normalises a valid customer deep link to a customer intent', () => {
    expect(normalizeDeepLinkIntent('chakusa://booking/abc123', NOW)).toEqual({
      experience: 'customer', source: 'deep-link', route: 'BookingDetail', params: { bookingId: 'abc123' }, createdAt: NOW,
    });
    expect(normalizeDeepLinkIntent('chakusa://my-rewards', NOW)).toMatchObject({ experience: 'customer', route: 'CustomerRewards' });
    expect(normalizeDeepLinkIntent('chakusa://loyalty/biz-1', NOW)).toMatchObject({ experience: 'customer', route: 'CustomerLoyaltyBusiness', params: { businessId: 'biz-1' } });
  });

  it('normalises a valid business deep link to a business intent', () => {
    expect(normalizeDeepLinkIntent('chakusa://reset-password', NOW)).toMatchObject({ experience: 'business', route: 'ResetPassword' });
    expect(normalizeDeepLinkIntent('chakusa://team-invite/tok9', NOW)).toMatchObject({ experience: 'business', route: 'TeamInvite', params: { token: 'tok9' } });
  });

  it('classifies other business links as business but route-less (land on the safe default)', () => {
    expect(normalizeDeepLinkIntent('chakusa://dashboard', NOW)).toEqual({ experience: 'business', source: 'deep-link', route: null, params: undefined, createdAt: NOW });
  });

  it('returns null for unknown, malformed and empty links', () => {
    expect(normalizeDeepLinkIntent('chakusa://totally-unknown/x', NOW)).toBeNull();
    expect(normalizeDeepLinkIntent('garbage', NOW)).toBeNull();
    expect(normalizeDeepLinkIntent('', NOW)).toBeNull();
    expect(normalizeDeepLinkIntent(null, NOW)).toBeNull();
    expect(normalizeDeepLinkIntent('chakusa://', NOW)).toBeNull();
  });

  it('does not let a business-owner route become a customer intent (guard intact)', () => {
    // parseCustomerDeepLink refuses these, so they fall through to the
    // business allowlist and become route-less business intents, never
    // customer.
    expect(normalizeDeepLinkIntent('chakusa://dashboard', NOW)?.experience).toBe('business');
    expect(normalizeDeepLinkIntent('chakusa://loyalty-management', NOW)).toBeNull();
  });
});

describe('normalizeNotificationIntent', () => {
  it('uses a structured deep link on the payload', () => {
    expect(normalizeNotificationIntent({ category: 'loyalty', deepLink: 'chakusa://loyalty/biz-2' }, NOW))
      .toMatchObject({ experience: 'customer', source: 'notification', route: 'CustomerLoyaltyBusiness', params: { businessId: 'biz-2' } });
  });

  it('maps a loyalty category to a customer loyalty destination', () => {
    expect(normalizeNotificationIntent({ category: 'loyalty', loyaltyKind: 'reward_unlocked', businessId: 'b7' }, NOW))
      .toMatchObject({ experience: 'customer', route: 'CustomerLoyaltyBusiness', params: { businessId: 'b7' } });
    expect(normalizeNotificationIntent({ category: 'loyalty', loyaltyKind: 'membership_expiring' }, NOW))
      .toMatchObject({ experience: 'customer', route: 'CustomerMemberships' });
  });

  it('maps other customer categories to a route-less customer intent', () => {
    expect(normalizeNotificationIntent({ category: 'booking_update' }, NOW)).toEqual({ experience: 'customer', source: 'notification', route: null, createdAt: NOW });
  });

  it('maps a business notification to a route-less business intent', () => {
    expect(normalizeNotificationIntent({ experience: 'business', type: 'lead_created' }, NOW)).toEqual({ experience: 'business', source: 'notification', route: null, createdAt: NOW });
  });

  it('returns null for an unclassifiable payload — no privileged navigation', () => {
    expect(normalizeNotificationIntent(null, NOW)).toBeNull();
    expect(normalizeNotificationIntent({}, NOW)).toBeNull();
    expect(normalizeNotificationIntent({ title: 'You have a new lead' }, NOW)).toBeNull();
  });
});

describe('serialize / parse round trip', () => {
  it('round-trips a valid intent', () => {
    const intent = normalizeDeepLinkIntent('chakusa://book/glow-studio', NOW)!;
    expect(parsePendingIntent(serializePendingIntent(intent), NOW)).toEqual(intent);
  });

  it('rejects malformed persisted data', () => {
    expect(parsePendingIntent('not json', NOW)).toBeNull();
    expect(parsePendingIntent('{}', NOW)).toBeNull();
    expect(parsePendingIntent(JSON.stringify({ v: 1, experience: 'admin', source: 'deep-link', route: null, createdAt: NOW }), NOW)).toBeNull();
    expect(parsePendingIntent(JSON.stringify({ v: 2, experience: 'customer', source: 'deep-link', route: null, createdAt: NOW }), NOW)).toBeNull();
    expect(parsePendingIntent(JSON.stringify({ v: 1, experience: 'customer', source: 'x', route: null, createdAt: NOW }), NOW)).toBeNull();
  });

  it('rejects an expired intent', () => {
    const intent = normalizeDeepLinkIntent('chakusa://my-rewards', NOW)!;
    const raw = serializePendingIntent(intent);
    expect(parsePendingIntent(raw, NOW + PENDING_INTENT_TTL_MS + 1)).toBeNull();
    expect(parsePendingIntent(raw, NOW + PENDING_INTENT_TTL_MS - 1)).not.toBeNull();
  });

  it('rejects a clock-skewed future timestamp', () => {
    const raw = serializePendingIntent(normalizeDeepLinkIntent('chakusa://my-rewards', NOW)!);
    expect(parsePendingIntent(raw, NOW - 5 * 60_000)).toBeNull();
  });

  it('drops nested / oversized params on the way back in', () => {
    const raw = JSON.stringify({ v: 1, experience: 'customer', source: 'deep-link', route: 'X', params: { ok: 'y', nested: { a: 1 }, big: 'z'.repeat(500) }, createdAt: NOW });
    expect(parsePendingIntent(raw, NOW)?.params).toEqual({ ok: 'y' });
  });

  it('never carries anything token-shaped', () => {
    const raw = serializePendingIntent(normalizeDeepLinkIntent('chakusa://booking/1', NOW)!);
    expect(raw).not.toMatch(/token|accessToken|refreshToken|session|bearer/i);
  });
});
