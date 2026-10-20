import { config } from "../config.js";

// Google Places API (New), server-side only. Off unless GOOGLE_PLACES_API_KEY
// is set. Per Google Maps Platform terms only the place ID is stored (on
// Business.googlePlaceId); rating, review count and nearby results are
// fetched live and held in a short in-process cache to absorb bursts, never
// written to the database. Clients must show "Google" attribution and must
// not draw these results on a non-Google map.

const BASE = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;

export interface GoogleRating { rating: number | null; reviewCount: number; mapsUrl: string | null }
export interface GooglePlaceSummary { placeId: string; name: string; address: string | null; latitude: number | null; longitude: number | null; rating: number | null; reviewCount: number; category: string | null; mapsUrl: string | null; openNow: boolean | null }

interface RawPlace {
  id?: string;
  displayName?: { text?: string };
  shortFormattedAddress?: string;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  primaryTypeDisplayName?: { text?: string };
  googleMapsUri?: string;
  businessStatus?: string;
  currentOpeningHours?: { openNow?: boolean };
}
type RawResponse = RawPlace & { places?: RawPlace[] };

type Fetcher = typeof fetch;
let fetcher: Fetcher = (...args) => fetch(...args);
/** Test seam. */
export function setGooglePlacesFetcher(next: Fetcher | null) { fetcher = next ?? ((...args) => fetch(...args)); cache.clear(); }

const cache = new Map<string, { at: number; value: unknown }>();
function cached<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return undefined; }
  return hit.value as T;
}
function remember(key: string, value: unknown) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), value });
}

export function googlePlacesEnabled() { return Boolean(config.GOOGLE_PLACES_API_KEY); }

async function call(path: string, init: { method: "GET" | "POST"; fieldMask: string; body?: unknown }): Promise<RawResponse | null> {
  if (!config.GOOGLE_PLACES_API_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(`${BASE}${path}`, {
      method: init.method,
      headers: { "content-type": "application/json", "x-goog-api-key": config.GOOGLE_PLACES_API_KEY, "x-goog-fieldmask": init.fieldMask },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: controller.signal,
    });
    if (!response.ok) { console.warn("[googlePlaces] request failed", path.split("?")[0], response.status); return null; }
    return (await response.json()) as RawResponse;
  } catch (err) {
    console.warn("[googlePlaces] request error", (err as Error).name);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function summarize(place: RawPlace): GooglePlaceSummary | null {
  if (!place?.id) return null;
  return {
    placeId: String(place.id),
    name: String(place.displayName?.text ?? ""),
    address: place.shortFormattedAddress ?? place.formattedAddress ?? null,
    latitude: typeof place.location?.latitude === "number" ? place.location.latitude : null,
    longitude: typeof place.location?.longitude === "number" ? place.location.longitude : null,
    rating: typeof place.rating === "number" ? place.rating : null,
    reviewCount: typeof place.userRatingCount === "number" ? place.userRatingCount : 0,
    category: place.primaryTypeDisplayName?.text ?? null,
    mapsUrl: place.googleMapsUri ?? null,
    openNow: typeof place.currentOpeningHours?.openNow === "boolean" ? place.currentOpeningHours.openNow : null,
  };
}

const PLACE_ID = /^[A-Za-z0-9_-]{10,300}$/;

/** Live Google rating for a linked place, or null when unavailable. */
export async function googleRating(placeId: string | null | undefined): Promise<GoogleRating | null> {
  if (!placeId || !PLACE_ID.test(placeId) || !googlePlacesEnabled()) return null;
  const key = `rating:${placeId}`;
  const hit = cached<GoogleRating | null>(key);
  if (hit !== undefined) return hit;
  const place = await call(`/places/${encodeURIComponent(placeId)}`, { method: "GET", fieldMask: "id,rating,userRatingCount,googleMapsUri" });
  const value = place ? { rating: typeof place.rating === "number" ? place.rating : null, reviewCount: typeof place.userRatingCount === "number" ? place.userRatingCount : 0, mapsUrl: place.googleMapsUri ?? null } : null;
  remember(key, value);
  return value;
}

/** Candidates for an owner linking their Google listing. */
export async function searchGooglePlaces(query: string, near?: { latitude: number; longitude: number }): Promise<GooglePlaceSummary[]> {
  const text = query.trim().slice(0, 200);
  if (text.length < 2 || !googlePlacesEnabled()) return [];
  const result = await call("/places:searchText", {
    method: "POST",
    fieldMask: "places.id,places.displayName,places.shortFormattedAddress,places.location,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.googleMapsUri",
    body: { textQuery: text, pageSize: 8, ...(near ? { locationBias: { circle: { center: near, radius: 30000 } } } : {}) },
  });
  return (result?.places ?? []).map(summarize).filter((p): p is GooglePlaceSummary => Boolean(p));
}

/** Operating places near a point, for the "also nearby on Google" list. */
export async function nearbyGooglePlaces(input: { latitude: number; longitude: number; radiusKm: number; query?: string }): Promise<GooglePlaceSummary[]> {
  if (!googlePlacesEnabled()) return [];
  const radius = Math.min(Math.max(input.radiusKm, 0.5), 50) * 1000;
  const lat = input.latitude.toFixed(3); const lng = input.longitude.toFixed(3);
  const key = `nearby:${lat}:${lng}:${radius}:${input.query ?? ""}`;
  const hit = cached<GooglePlaceSummary[]>(key);
  if (hit) return hit;
  const fieldMask = "places.id,places.displayName,places.shortFormattedAddress,places.location,places.rating,places.userRatingCount,places.primaryTypeDisplayName,places.googleMapsUri,places.businessStatus,places.currentOpeningHours.openNow";
  const circle = { circle: { center: { latitude: input.latitude, longitude: input.longitude }, radius } };
  const result = input.query?.trim()
    ? await call("/places:searchText", { method: "POST", fieldMask, body: { textQuery: input.query.trim().slice(0, 120), pageSize: 20, locationBias: circle } })
    : await call("/places:searchNearby", { method: "POST", fieldMask, body: { maxResultCount: 20, locationRestriction: circle, rankPreference: "POPULARITY" } });
  const places = (result?.places ?? [])
    .filter((place) => !place.businessStatus || place.businessStatus === "OPERATIONAL")
    .map(summarize)
    .filter((p): p is GooglePlaceSummary => Boolean(p));
  remember(key, places);
  return places;
}
