import { describe, expect, it } from 'vitest';
import type { CustomerDashboardDto, CustomerNotificationDto, CustomerSessionResponse } from '../apiTypes';
import {
  canNavigateCustomer,
  customerAuthState,
  dashboardIsEmpty,
  groupNotificationsByCategory,
  initialCustomerRoute,
  isSupportedLanguage,
  mergeNotificationPreferences,
  notificationBadge,
  notificationCategoryLabel,
  sessionFromResponse,
  summarizeDashboard,
  unreadCount,
  validateRegistration,
} from './customerPlatform';

const profile = (over: Partial<{ status: 'ACTIVE' | 'SUSPENDED' | 'DELETED'; verified: boolean }> = {}) => ({
  status: over.status ?? ('ACTIVE' as const),
  verified: over.verified ?? true,
});

const notification = (over: Partial<CustomerNotificationDto>): CustomerNotificationDto => ({
  id: over.id ?? 'n', businessId: null, category: over.category ?? 'message', title: 't', body: 'b',
  data: null, channels: null, readAt: over.readAt ?? null, createdAt: '2026-08-31T10:00:00Z', ...over,
});

const dashboard = (over: Partial<CustomerDashboardDto> = {}): CustomerDashboardDto => ({
  savedBusinesses: [], businesses: [], upcomingAppointments: [], recentConversations: [], recentReviews: [],
  aiAssistant: { recentRuns: [], entryEnabled: false }, unreadNotifications: 0, activityHistory: [],
  generatedAt: '2026-08-31T10:00:00Z', ...over,
});

describe('Customer Platform mobile foundation (Program 2, Loop 1)', () => {
  describe('auth flow', () => {
    it('derives the auth state and initial route', () => {
      expect(customerAuthState(null)).toBe('unauthenticated');
      expect(customerAuthState({ hasToken: true, profile: profile({ verified: false }), verificationRequired: true })).toBe('verify-email');
      expect(customerAuthState({ hasToken: true, profile: profile() })).toBe('ready');
      expect(customerAuthState({ hasToken: true, profile: profile({ status: 'SUSPENDED' }) })).toBe('suspended');
      expect(customerAuthState({ hasToken: true, profile: profile({ status: 'DELETED' }) })).toBe('closed');

      expect(initialCustomerRoute('ready')).toBe('CustomerHome');
      expect(initialCustomerRoute('verify-email')).toBe('VerifyEmail');
      expect(initialCustomerRoute('suspended')).toBe('AccountSuspended');
      expect(initialCustomerRoute('unauthenticated')).toBe('Login');
    });

    it('gates navigation to authenticated state only', () => {
      expect(canNavigateCustomer('ready', 'dashboard')).toBe(true);
      expect(canNavigateCustomer('verify-email', 'dashboard')).toBe(false);
      expect(canNavigateCustomer('unauthenticated', 'profile')).toBe(false);
    });

    it('normalizes a session response', () => {
      const response = {
        accessToken: 'a', token: 'a', refreshToken: 'r', expiresIn: 900, tokenType: 'Bearer',
        user: { id: 'u', email: 'e', fullName: 'f', emailVerified: false, hasPassword: true, linkedProviders: [] },
        profile: { id: 'p', displayName: null, avatarUrl: null, preferredLanguage: 'en', preferredTimezone: 'UTC', status: 'ACTIVE', verified: false },
        verificationRequired: true,
      } satisfies CustomerSessionResponse;
      const session = sessionFromResponse(response);
      expect(session).toMatchObject({ accessToken: 'a', refreshToken: 'r', verificationRequired: true });
    });
  });

  describe('validation', () => {
    it('validates registration input', () => {
      expect(validateRegistration({ email: 'bad', password: 'short', fullName: '' })).toHaveLength(3);
      expect(validateRegistration({ email: 'a@b.co', password: 'password123', fullName: 'Casey' })).toEqual([]);
    });
    it('recognizes supported languages', () => {
      expect(isSupportedLanguage('fr')).toBe(true);
      expect(isSupportedLanguage('xx')).toBe(false);
    });
  });

  describe('dashboard', () => {
    it('summarizes and detects emptiness', () => {
      expect(dashboardIsEmpty(dashboard())).toBe(true);
      const full = dashboard({
        upcomingAppointments: [{ id: 'a1', serviceName: 'Cut', startsAt: '2026-09-01T10:00:00Z', status: 'CONFIRMED', business: { name: 'Salon' } }],
        savedBusinesses: [{ id: 'l1', businessId: 'b1', favourite: true, relationship: 'CUSTOMER', lastInteractionAt: null, business: null }],
        unreadNotifications: 3,
        aiAssistant: { recentRuns: [], entryEnabled: true },
        activityHistory: [{ id: 'e1', type: 'BUSINESS_FAVOURITED', createdAt: '2026-08-31T10:00:00Z' }],
      });
      expect(dashboardIsEmpty(full)).toBe(false);
      const summary = summarizeDashboard(full);
      expect(summary).toMatchObject({ upcomingCount: 1, unreadNotifications: 3, savedBusinessCount: 1, hasActivity: true, aiAssistantEnabled: true });
      expect(summary.nextAppointment?.serviceName).toBe('Cut');
    });
  });

  describe('notifications', () => {
    it('counts unread and renders a badge', () => {
      const items = [notification({ id: '1', readAt: null }), notification({ id: '2', readAt: '2026-08-31T11:00:00Z' }), notification({ id: '3', readAt: null })];
      expect(unreadCount(items)).toBe(2);
      expect(notificationBadge(0)).toBeNull();
      expect(notificationBadge(5)).toBe('5');
      expect(notificationBadge(150)).toBe('99+');
    });
    it('labels and groups by category', () => {
      expect(notificationCategoryLabel('booking_update')).toBe('Bookings');
      expect(notificationCategoryLabel('unknown')).toBe('Updates');
      const grouped = groupNotificationsByCategory([notification({ id: '1', category: 'message' }), notification({ id: '2', category: 'message' }), notification({ id: '3', category: 'promotion' })]);
      expect(grouped).toHaveLength(2);
      expect(grouped.find((g) => g.category === 'message')?.items).toHaveLength(2);
    });
    it('merges preference patches without dropping other channels', () => {
      const current = { message: { push: true, email: true }, promotion: { push: false, email: false } };
      const merged = mergeNotificationPreferences(current, { message: { email: false } });
      expect(merged.message).toEqual({ push: true, email: false });
      expect(merged.promotion).toEqual({ push: false, email: false });
    });
  });
});
