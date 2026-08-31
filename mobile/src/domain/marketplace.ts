import type {
  MarketplaceCardDto,
  MarketplaceCategoryDto,
  MarketplaceDiscoveryMode,
  MarketplaceBusinessProfileDto,
  MarketplaceRecentSearchDto,
  MarketplaceSuggestionsDto,
} from '../apiTypes';

// PROGRAM 2 LOOP 2: pure product rules for the customer-side Marketplace &
// Business Discovery mobile foundation — discovery feeds, categories, search,
// business profile and favourites/follow state. NO booking, calendar,
// payments or staff-selection logic (those belong to later loops).

// --- Navigation --------------------------------------------------------------

export type MarketplaceRoute = 'Marketplace' | 'Search' | 'Categories' | 'BusinessProfile' | 'Favourites';

export const MARKETPLACE_ROUTES: readonly MarketplaceRoute[] = ['Marketplace', 'Search', 'Categories', 'BusinessProfile', 'Favourites'];

/** Booking-related destinations must never be reachable from the marketplace in this loop. */
export function isBookingRoute(route: string): boolean {
  return /^(Booking|Checkout|Calendar|SelectStaff|SelectSlot|Payment|Pay)/i.test(route);
}

export function canNavigateMarketplace(route: string): route is MarketplaceRoute {
  return (MARKETPLACE_ROUTES as readonly string[]).includes(route) && !isBookingRoute(route);
}

// --- Discovery modes -------------------------------------------------------

export const DISCOVERY_MODES: readonly MarketplaceDiscoveryMode[] = ['browse', 'featured', 'recent', 'popular', 'verified', 'nearby'];

export function discoveryModeLabel(mode: MarketplaceDiscoveryMode): string {
  switch (mode) {
    case 'browse': return 'All businesses';
    case 'featured': return 'Featured';
    case 'recent': return 'Recently added';
    case 'popular': return 'Popular';
    case 'verified': return 'Verified';
    case 'nearby': return 'Near you';
  }
}

/** `nearby` needs a resolved location; everything else is always available. */
export function isDiscoveryModeAvailable(mode: MarketplaceDiscoveryMode, location: { lat: number; lng: number } | null): boolean {
  return mode === 'nearby' ? location != null : true;
}

// --- Business cards -------------------------------------------------------

export interface MarketplaceCardView {
  slug: string;
  name: string;
  categoryLabel: string;
  subtitle: string;
  photo: string | null;
  badges: string[];
  ratingLabel: string | null;
}

export function shapeCard(card: MarketplaceCardDto, categoryName?: string): MarketplaceCardView {
  const badges: string[] = [];
  if (card.featured) badges.push('Featured');
  if (card.verified) badges.push('Verified');
  return {
    slug: card.slug,
    name: card.name,
    categoryLabel: categoryName ?? titleCaseSlug(card.category),
    subtitle: card.tagline ?? ([card.city, card.region].filter(Boolean).join(', ') || (card.industry ?? '')),
    photo: card.photo,
    badges,
    ratingLabel: ratingStars(card.rating, card.reviewCount),
  };
}

export function titleCaseSlug(slug: string): string {
  return slug.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

/** Half-star aware compact rating label, e.g. "★★★★☆ 4.2 (18)". Null when there are no reviews. */
export function ratingStars(rating: number | null, reviewCount: number): string | null {
  if (rating == null || reviewCount === 0) return null;
  const clamped = Math.max(0, Math.min(5, rating));
  const full = Math.floor(clamped + 0.25);
  const half = clamped - full >= 0.25 && full < 5 ? 1 : 0;
  const empty = 5 - full - half;
  return `${'★'.repeat(full)}${half ? '⯨' : ''}${'☆'.repeat(empty)} ${clamped.toFixed(1)} (${reviewCount})`;
}

// --- Distance ----------------------------------------------------------------

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

export function formatDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

// --- Categories ------------------------------------------------------------

export interface CategoryGridItem {
  slug: string;
  name: string;
  icon: string | null;
  count: number;
  childSlugs: string[];
}

/** Top-level categories only, trending first, then by business count. */
export function categoryGrid(categories: MarketplaceCategoryDto[]): CategoryGridItem[] {
  return categories
    .filter((category) => category.active && !category.parentId)
    .slice()
    .sort((a, b) => Number(b.trending) - Number(a.trending) || b.businessCount - a.businessCount || a.sortOrder - b.sortOrder)
    .map((category) => ({
      slug: category.slug,
      name: category.name,
      icon: category.icon,
      count: category.businessCount,
      childSlugs: (category.children ?? []).filter((child) => child.active).map((child) => child.slug),
    }));
}

// --- Search --------------------------------------------------------------

export function normalizeSearchQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export function isSearchable(raw: string): boolean {
  return normalizeSearchQuery(raw).length >= 2;
}

export interface RankedSuggestion {
  kind: 'business' | 'category';
  label: string;
  value: string;
}

/** Prefix matches rank above substring matches; categories after businesses at equal rank. */
export function rankSuggestions(suggestions: MarketplaceSuggestionsDto, raw: string): RankedSuggestion[] {
  const q = normalizeSearchQuery(raw).toLowerCase();
  const score = (label: string) => {
    const l = label.toLowerCase();
    if (!q) return 2;
    if (l.startsWith(q)) return 0;
    if (l.includes(q)) return 1;
    return 3;
  };
  const rows: Array<RankedSuggestion & { s: number; k: number }> = [
    ...suggestions.businesses
      .filter((business) => business.publicSlug)
      .map((business) => ({ kind: 'business' as const, label: business.name, value: business.publicSlug as string, s: score(business.name), k: 0 })),
    ...suggestions.categories.map((category) => ({ kind: 'category' as const, label: category.name, value: category.slug, s: score(category.name), k: 1 })),
  ];
  return rows
    .filter((row) => row.s < 3)
    .sort((a, b) => a.s - b.s || a.k - b.k || a.label.localeCompare(b.label))
    .map(({ kind, label, value }) => ({ kind, label, value }));
}

/** De-dupes recent searches case-insensitively, preserving most-recent-first order. */
export function dedupeRecentSearches(rows: MarketplaceRecentSearchDto[], limit = 10): MarketplaceRecentSearchDto[] {
  const seen = new Set<string>();
  const out: MarketplaceRecentSearchDto[] = [];
  for (const row of rows) {
    const key = row.query.trim().toLowerCase();
    if (seen.has(key) || key.length === 0) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

// --- Recently viewed -----------------------------------------------------

/** Prepends a freshly viewed slug, removing any earlier occurrence, capped at `limit`. */
export function mergeRecentlyViewed(existing: string[], slug: string, limit = 20): string[] {
  return [slug, ...existing.filter((s) => s !== slug)].slice(0, limit);
}

// --- Favourite / follow toggle state -----------------------------------

export interface ToggleState {
  active: boolean;
  count: number;
}

export function nextToggleState(current: ToggleState, active: boolean): ToggleState {
  if (current.active === active) return current;
  return { active, count: Math.max(0, current.count + (active ? 1 : -1)) };
}

export function favouriteStateFromProfile(profile: Pick<MarketplaceBusinessProfileDto, 'viewer'>, favouriteCount = 0): ToggleState {
  return { active: profile.viewer.favourite, count: favouriteCount };
}

// --- Business profile ----------------------------------------------------

export interface BusinessProfileSections {
  hasAbout: boolean;
  hasPhotos: boolean;
  hasServices: boolean;
  hasTeam: boolean;
  hasPromotions: boolean;
  hasHours: boolean;
  hasSocial: boolean;
  hasReviews: boolean;
}

export function profileSections(profile: MarketplaceBusinessProfileDto): BusinessProfileSections {
  return {
    hasAbout: Boolean(profile.about && profile.about.trim()),
    hasPhotos: profile.photos.length > 0,
    hasServices: profile.services.length > 0,
    hasTeam: profile.team.length > 0,
    hasPromotions: profile.promotions.length > 0,
    hasHours: profile.openingHours != null,
    hasSocial: Object.keys(profile.socialLinks).length > 0,
    hasReviews: profile.reviewsSummary.totalReviews > 0,
  };
}

/** Services are shown for information only in this loop — a price, never a "Book" affordance. */
export function serviceDisplay(service: MarketplaceBusinessProfileDto['services'][number], currency = ''): { name: string; meta: string; canBook: false } {
  const parts = [`${service.durationMinutes} min`];
  if (service.price != null) parts.push(`${currency}${service.price}`.trim());
  return { name: service.name, meta: parts.join(' · '), canBook: false };
}

export const REPORT_REASONS = ['spam', 'inappropriate', 'closed', 'wrong_info', 'scam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export function reportReasonLabel(reason: ReportReason): string {
  switch (reason) {
    case 'spam': return 'Spam or fake listing';
    case 'inappropriate': return 'Inappropriate content';
    case 'closed': return 'Business has closed';
    case 'wrong_info': return 'Incorrect information';
    case 'scam': return 'Scam or fraud';
    case 'other': return 'Something else';
  }
}
