import { describe, expect, it } from 'vitest';
import type {
  MarketplaceCardDto,
  MarketplaceCategoryDto,
  MarketplaceBusinessProfileDto,
  MarketplaceRecentSearchDto,
  MarketplaceSuggestionsDto,
} from '../apiTypes';
import {
  canNavigateMarketplace,
  categoryGrid,
  dedupeRecentSearches,
  discoveryModeLabel,
  formatDistance,
  haversineKm,
  isBookingRoute,
  isDiscoveryModeAvailable,
  isSearchable,
  mergeRecentlyViewed,
  nextToggleState,
  normalizeSearchQuery,
  profileSections,
  rankSuggestions,
  ratingStars,
  reportReasonLabel,
  serviceDisplay,
  shapeCard,
  titleCaseSlug,
} from './marketplace';

const card = (over: Partial<MarketplaceCardDto> = {}): MarketplaceCardDto => ({
  slug: 'bloom-hair', name: 'Bloom Hair', category: 'hair', subcategory: null, industry: 'hair salon',
  tagline: null, city: 'London', region: 'Greater London', photo: null, verified: false, featured: false,
  rating: null, reviewCount: 0, viewCount: 0, favouriteCount: 0, createdAt: '2026-08-01T00:00:00Z', ...over,
});

const category = (over: Partial<MarketplaceCategoryDto> = {}): MarketplaceCategoryDto => ({
  id: over.slug ?? 'c', slug: over.slug ?? 'beauty', name: over.name ?? 'Beauty', icon: 'sparkles',
  description: null, parentId: over.parentId ?? null, sortOrder: over.sortOrder ?? 10,
  trending: over.trending ?? false, active: over.active ?? true, businessCount: over.businessCount ?? 0,
  children: over.children, ...over,
});

describe('marketplace domain (Program 2, Loop 2)', () => {
  describe('navigation guards — no booking', () => {
    it('allows the five marketplace routes', () => {
      expect(canNavigateMarketplace('Marketplace')).toBe(true);
      expect(canNavigateMarketplace('Search')).toBe(true);
      expect(canNavigateMarketplace('Categories')).toBe(true);
      expect(canNavigateMarketplace('BusinessProfile')).toBe(true);
      expect(canNavigateMarketplace('Favourites')).toBe(true);
    });
    it('rejects booking-flow routes', () => {
      for (const route of ['Booking', 'BookingConfirm', 'Checkout', 'Calendar', 'SelectStaff', 'SelectSlot', 'Payment']) {
        expect(isBookingRoute(route)).toBe(true);
        expect(canNavigateMarketplace(route)).toBe(false);
      }
    });
  });

  describe('discovery modes', () => {
    it('labels every mode', () => {
      expect(discoveryModeLabel('recent')).toBe('Recently added');
      expect(discoveryModeLabel('nearby')).toBe('Near you');
    });
    it('gates nearby on a resolved location', () => {
      expect(isDiscoveryModeAvailable('nearby', null)).toBe(false);
      expect(isDiscoveryModeAvailable('nearby', { lat: 51.5, lng: -0.1 })).toBe(true);
      expect(isDiscoveryModeAvailable('browse', null)).toBe(true);
    });
  });

  describe('card shaping & rating', () => {
    it('builds badges, subtitle and category label', () => {
      const view = shapeCard(card({ featured: true, verified: true, tagline: 'Colour specialists' }));
      expect(view.badges).toEqual(['Featured', 'Verified']);
      expect(view.subtitle).toBe('Colour specialists');
      expect(view.categoryLabel).toBe('Hair');
    });
    it('falls back to location then industry for the subtitle', () => {
      expect(shapeCard(card({ tagline: null })).subtitle).toBe('London, Greater London');
      expect(shapeCard(card({ tagline: null, city: null, region: null })).subtitle).toBe('hair salon');
    });
    it('renders half-star aware rating labels, null when no reviews', () => {
      expect(ratingStars(null, 0)).toBeNull();
      expect(ratingStars(4.2, 18)).toBe('★★★★☆ 4.2 (18)');
      expect(ratingStars(5, 3)).toBe('★★★★★ 5.0 (3)');
      expect(ratingStars(3.5, 4)).toBe('★★★⯨☆ 3.5 (4)');
    });
    it('title-cases slugs', () => {
      expect(titleCaseSlug('mobile-detailing')).toBe('Mobile Detailing');
    });
  });

  describe('distance', () => {
    it('measures and formats distance', () => {
      const d = haversineKm({ lat: 51.5, lng: -0.12 }, { lat: 51.51, lng: -0.13 });
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(3);
      expect(formatDistance(0.4)).toBe('400 m');
      expect(formatDistance(4.25)).toBe('4.3 km');
      expect(formatDistance(42)).toBe('42 km');
      expect(formatDistance(-1)).toBe('');
    });
  });

  describe('category grid', () => {
    it('keeps top-level only, trending first then by count', () => {
      const grid = categoryGrid([
        category({ slug: 'beauty', name: 'Beauty', trending: false, businessCount: 3, children: [category({ slug: 'hair', parentId: 'beauty' })] }),
        category({ slug: 'wellness', name: 'Wellness', trending: true, businessCount: 1 }),
        category({ slug: 'hair', name: 'Hair', parentId: 'beauty', businessCount: 2 }),
        category({ slug: 'dead', name: 'Dead', active: false }),
      ]);
      expect(grid.map((g) => g.slug)).toEqual(['wellness', 'beauty']);
      expect(grid[1].childSlugs).toEqual(['hair']);
    });
  });

  describe('search', () => {
    it('normalizes and validates queries', () => {
      expect(normalizeSearchQuery('  hair   salon ')).toBe('hair salon');
      expect(isSearchable('a')).toBe(false);
      expect(isSearchable(' ab ')).toBe(true);
    });
    it('ranks prefix matches above substring, businesses before categories', () => {
      const suggestions: MarketplaceSuggestionsDto = {
        businesses: [
          { name: 'Aurora Beauty', publicSlug: 'aurora-beauty' },
          { name: 'The Beauty Aurora', publicSlug: 'the-beauty-aurora' },
          { name: 'No Slug', publicSlug: null },
        ],
        categories: [{ slug: 'beauty', name: 'Beauty', icon: null }],
      };
      const ranked = rankSuggestions(suggestions, 'aur');
      expect(ranked[0]).toEqual({ kind: 'business', label: 'Aurora Beauty', value: 'aurora-beauty' });
      expect(ranked.some((r) => r.label === 'No Slug')).toBe(false);
      expect(ranked.some((r) => r.label === 'The Beauty Aurora')).toBe(true);
    });
    it('de-dupes recent searches case-insensitively', () => {
      const rows: MarketplaceRecentSearchDto[] = [
        { id: '1', query: 'Balayage', resultCount: 3, createdAt: '2026-08-31T12:00:00Z' },
        { id: '2', query: 'balayage', resultCount: 2, createdAt: '2026-08-31T11:00:00Z' },
        { id: '3', query: 'nails', resultCount: 5, createdAt: '2026-08-31T10:00:00Z' },
      ];
      expect(dedupeRecentSearches(rows).map((r) => r.id)).toEqual(['1', '3']);
    });
  });

  describe('recently viewed & toggles', () => {
    it('moves a re-viewed slug to the front and caps length', () => {
      expect(mergeRecentlyViewed(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c']);
      expect(mergeRecentlyViewed(['a', 'b', 'c'], 'd', 3)).toEqual(['d', 'a', 'b']);
    });
    it('advances favourite/follow toggle counts without going negative', () => {
      expect(nextToggleState({ active: false, count: 4 }, true)).toEqual({ active: true, count: 5 });
      expect(nextToggleState({ active: true, count: 1 }, false)).toEqual({ active: false, count: 0 });
      expect(nextToggleState({ active: false, count: 0 }, false)).toEqual({ active: false, count: 0 });
      const same = { active: true, count: 2 };
      expect(nextToggleState(same, true)).toBe(same);
    });
  });

  describe('business profile', () => {
    const profile = (over: Partial<MarketplaceBusinessProfileDto> = {}): MarketplaceBusinessProfileDto => ({
      slug: 'p', name: 'Palace', about: 'A calm retreat', category: 'spa', industry: 'spa', tagline: null,
      verified: true, contact: { phone: '+15550001111' },
      address: { line: null, city: 'London', region: null, country: 'GB', latitude: null, longitude: null },
      openingHours: { mon: '9-5' }, photos: ['x.jpg'], socialLinks: { instagram: 'https://ig/x' },
      services: [{ id: 's', name: 'Massage', description: null, category: null, durationMinutes: 60, price: 80, depositAmount: null, bookable: true }],
      team: [{ name: 'Sam', role: 'OWNER' }],
      promotions: [{ id: 'pr', title: 'Spring', description: null, badge: '-20%', endsAt: null }],
      reviewsSummary: { averageRating: 5, totalReviews: 1, recent: [] },
      viewer: { favourite: false, following: false }, shareUrl: 'https://chakusa.app/b/p', businessId: 'b', ...over,
    });

    it('detects which sections have content', () => {
      const sections = profileSections(profile());
      expect(sections).toEqual({
        hasAbout: true, hasPhotos: true, hasServices: true, hasTeam: true,
        hasPromotions: true, hasHours: true, hasSocial: true, hasReviews: true,
      });
      const bare = profileSections(profile({ about: '  ', photos: [], services: [], team: [], promotions: [], openingHours: null, socialLinks: {}, reviewsSummary: { averageRating: null, totalReviews: 0, recent: [] } }));
      expect(Object.values(bare).every((v) => v === false)).toBe(true);
    });

    it('renders services as information only — never bookable', () => {
      const display = serviceDisplay(profile().services[0], '£');
      expect(display).toEqual({ name: 'Massage', meta: '60 min · £80', canBook: false });
    });

    it('labels report reasons', () => {
      expect(reportReasonLabel('wrong_info')).toBe('Incorrect information');
      expect(reportReasonLabel('scam')).toBe('Scam or fraud');
    });
  });
});
