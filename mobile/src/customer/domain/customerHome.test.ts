import { describe, expect, it } from 'vitest';
import type { CustomerDashboardDto } from '../../apiTypes';
import {
  assistantEntryVisible,
  homeBusinesses,
  homeGreeting,
  homeSectionsState,
  homeUpcoming,
  unreadBadge,
} from './customerHome';

const dashboard: CustomerDashboardDto = {
  savedBusinesses: [
    { id: 'l1', businessId: 'b1', favourite: true, relationship: 'customer', lastInteractionAt: null, business: { id: 'b1', name: 'Glow Studio', industry: null, publicSlug: 'glow-studio' } },
  ],
  businesses: [
    { id: 'l1', businessId: 'b1', favourite: true, relationship: 'customer', lastInteractionAt: null, business: { id: 'b1', name: 'Glow Studio', industry: null, publicSlug: 'glow-studio' } },
    { id: 'l2', businessId: 'b2', favourite: false, relationship: 'customer', lastInteractionAt: null, business: { id: 'b2', name: 'Sharp Cuts', industry: null, publicSlug: 'sharp-cuts' } },
  ],
  upcomingAppointments: [
    { id: 'a2', serviceName: 'Trim', startsAt: '2026-09-10T10:00:00.000Z', status: 'CONFIRMED', business: { name: 'Sharp Cuts' } },
    { id: 'a1', serviceName: 'Facial', startsAt: '2026-09-05T09:00:00.000Z', status: 'SCHEDULED', business: { name: 'Glow Studio' } },
  ],
  recentConversations: [],
  recentReviews: [],
  aiAssistant: { recentRuns: [], entryEnabled: true },
  unreadNotifications: 4,
  activityHistory: [],
  generatedAt: '2026-09-02T00:00:00.000Z',
};

describe('homeGreeting', () => {
  it('picks a daypart and first name', () => {
    expect(homeGreeting('Ada Lovelace', new Date('2026-09-02T08:00:00'))).toEqual({ title: 'Good morning, Ada', subtitle: 'Here’s what’s coming up' });
    expect(homeGreeting('Ada', new Date('2026-09-02T14:00:00')).title).toBe('Good afternoon, Ada');
    expect(homeGreeting('Ada', new Date('2026-09-02T20:00:00')).title).toBe('Good evening, Ada');
  });

  it('falls back to a bare greeting with no name', () => {
    expect(homeGreeting(null, new Date('2026-09-02T08:00:00')).title).toBe('Good morning');
    expect(homeGreeting('   ', new Date('2026-09-02T08:00:00')).title).toBe('Good morning');
  });
});

describe('homeUpcoming', () => {
  it('sorts by start time and caps the list', () => {
    const result = homeUpcoming(dashboard);
    expect(result.map((r) => r.id)).toEqual(['a1', 'a2']);
    expect(result[0]).toMatchObject({ serviceName: 'Facial', businessName: 'Glow Studio', status: 'SCHEDULED' });
    expect(homeUpcoming(dashboard, 1)).toHaveLength(1);
  });

  it('substitutes a label when the business is missing', () => {
    const result = homeUpcoming({ upcomingAppointments: [{ id: 'x', serviceName: 'S', startsAt: '2026-09-01T00:00:00Z', status: 'SCHEDULED', business: null }] });
    expect(result[0].businessName).toBe('Your appointment');
  });
});

describe('homeBusinesses', () => {
  it('de-duplicates across saved and all lists', () => {
    const result = homeBusinesses(dashboard);
    expect(result.map((r) => r.businessId)).toEqual(['b1', 'b2']);
    expect(result[0]).toMatchObject({ name: 'Glow Studio', slug: 'glow-studio', favourite: true });
  });

  it('respects the limit', () => {
    expect(homeBusinesses(dashboard, 1)).toHaveLength(1);
  });
});

describe('unreadBadge', () => {
  it('formats the badge count', () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(-2)).toBeNull();
    expect(unreadBadge(4)).toBe('4');
    expect(unreadBadge(150)).toBe('99+');
  });
});

describe('assistantEntryVisible', () => {
  it('reflects the backend flag', () => {
    expect(assistantEntryVisible(dashboard)).toBe(true);
    expect(assistantEntryVisible({ aiAssistant: { recentRuns: [], entryEnabled: false } })).toBe(false);
  });
});

describe('homeSectionsState', () => {
  it('reports which sections have content', () => {
    expect(homeSectionsState(dashboard)).toEqual({ hasUpcoming: true, hasBusinesses: true, isEmpty: false });
  });

  it('detects a fully empty dashboard', () => {
    const empty: CustomerDashboardDto = { ...dashboard, savedBusinesses: [], businesses: [], upcomingAppointments: [] };
    expect(homeSectionsState(empty)).toEqual({ hasUpcoming: false, hasBusinesses: false, isEmpty: true });
  });
});
