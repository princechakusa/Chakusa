import { Platform } from 'react-native';
import { SUPPORT_EMAIL } from '../config';
import { placeFromNominatim, type NominatimResult, type Place } from '../domain/places';

// Address lookups through Nominatim, OpenStreetMap's free geocoder
// (https://operations.osmfoundation.org/policies/nominatim/). Its usage
// policy is honoured here: at most one request per second from this app,
// results cached, an identifying User-Agent on native (browsers send their
// own, plus a Referer), and the required attribution is shown on the map.
// No API key and no cost. Coordinates are only sent when the person asks
// for a lookup; nothing is stored.

const BASE = 'https://nominatim.openstreetmap.org';
const MIN_INTERVAL_MS = 1100;
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, unknown>();

export class GeocodingError extends Error {}

function throttled<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return work();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function nominatim<T>(path: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams({ format: 'jsonv2', addressdetails: '1', ...params }).toString();
  const key = `${path}?${query}`;
  if (cache.has(key)) return cache.get(key) as T;
  const body = await throttled(async () => {
    const headers: Record<string, string> = { Accept: 'application/json', 'Accept-Language': 'en' };
    if (Platform.OS !== 'web') headers['User-Agent'] = `Chakusa/1.0 (${SUPPORT_EMAIL})`;
    let response: Response;
    try {
      response = await fetch(`${BASE}${path}?${query}`, { headers });
    } catch {
      throw new GeocodingError('Could not reach the map service. Check your connection and try again.');
    }
    if (!response.ok) throw new GeocodingError('The map service is busy. Try again in a moment.');
    return response.json() as Promise<T>;
  });
  cache.set(key, body);
  return body;
}

/** The area name for a point, e.g. "Avondale, Harare". Rounded to ~11 m so repeat lookups hit the cache. */
export async function reverseGeocode(latitude: number, longitude: number): Promise<Place> {
  const result = await nominatim<NominatimResult & { error?: string }>('/reverse', { lat: latitude.toFixed(4), lon: longitude.toFixed(4), zoom: '18' });
  if (result.error) return { latitude, longitude, label: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, addressLine: null, city: null, region: null };
  return { ...placeFromNominatim(result), latitude, longitude };
}

/** Places matching free text, e.g. "Avondale Harare". */
export async function searchPlaces(text: string): Promise<Place[]> {
  const q = text.trim();
  if (q.length < 3) return [];
  const results = await nominatim<NominatimResult[]>('/search', { q, limit: '5' });
  return results.map(placeFromNominatim);
}
