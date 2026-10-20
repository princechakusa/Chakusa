// Nearby service businesses from OpenStreetMap (Overpass API) - free, and
// licensed (ODbL) for caching and for drawing on our OpenStreetMap map, as
// long as clients show "© OpenStreetMap contributors". Used for the "also
// nearby" places that are not on Chakusa yet.
//
// Fair use of the public Overpass service: results are cached per ~1 km area
// for a day, at most one upstream request runs at a time, every request
// identifies the app, and failures degrade to an empty list.

const OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const TIMEOUT_MS = 9000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 2000;
const USER_AGENT = "Chakusa/1.0 (+https://chakusarecovery.com; support@chakusarecovery.com)";

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";

export interface OsmPlace {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  address: string | null;
  phone: string | null;
  website: string | null;
  openingHours: string | null;
  googleMapsUrl: string;
}

// OSM tag -> customer-facing category. Service businesses people book.
const CATEGORY: Record<string, string> = {
  "shop=hairdresser": "Hair & barber",
  "shop=beauty": "Beauty",
  "shop=massage": "Massage",
  "shop=cosmetics": "Beauty",
  "shop=tattoo": "Tattoo",
  "shop=car_repair": "Car repair",
  "shop=tyres": "Tyres",
  "shop=laundry": "Laundry",
  "shop=dry_cleaning": "Dry cleaning",
  "shop=tailor": "Tailor",
  "shop=pet_grooming": "Pet grooming",
  "amenity=spa": "Spa",
  "leisure=spa": "Spa",
  "leisure=fitness_centre": "Fitness",
  "amenity=dentist": "Dentist",
  "amenity=clinic": "Clinic",
  "amenity=veterinary": "Vet",
  "craft=photographer": "Photographer",
  "amenity=car_wash": "Car wash",
};
const SELECTORS = Object.keys(CATEGORY).map((tag) => { const [k, v] = tag.split("="); return `nwr["${k}"="${v}"]["name"]`; });

type Fetcher = typeof fetch;
let fetcher: Fetcher = (...args) => fetch(...args);
/** Test seam. */
export function setOsmFetcher(next: Fetcher | null) { fetcher = next ?? ((...args) => fetch(...args)); cache.clear(); }

const cache = new Map<string, { at: number; places: OsmPlace[] }>();
let inFlight: Promise<unknown> = Promise.resolve();

/** Free Google Maps link (Maps URLs - no key, no billing) that opens the business by name near its position. */
export function googleMapsSearchUrl(name: string, near: { latitude: number; longitude: number } | null, area?: string | null): string {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  const where = area?.trim() || (near ? `${near.latitude.toFixed(5)},${near.longitude.toFixed(5)}` : "");
  url.searchParams.set("query", [name.trim(), where].filter(Boolean).join(" "));
  return url.toString();
}

interface OverpassElement { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

function toPlace(el: OverpassElement): OsmPlace | null {
  const tags = el.tags ?? {};
  const latitude = el.lat ?? el.center?.lat; const longitude = el.lon ?? el.center?.lon;
  if (!tags.name || typeof latitude !== "number" || typeof longitude !== "number") return null;
  const tagKey = Object.keys(CATEGORY).find((t) => { const [k, v] = t.split("="); return tags[k!] === v; });
  if (!tagKey) return null;
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const address = [street, tags["addr:suburb"] ?? tags["addr:city"]].filter(Boolean).join(", ") || null;
  const website = tags.website ?? tags["contact:website"] ?? null;
  return {
    id: `${el.type}/${el.id}`,
    name: tags.name.slice(0, 120),
    category: CATEGORY[tagKey]!,
    latitude, longitude,
    address,
    phone: (tags.phone ?? tags["contact:phone"] ?? null)?.slice(0, 40) ?? null,
    website: website && /^https?:\/\//i.test(website) ? website.slice(0, 300) : null,
    openingHours: tags.opening_hours?.slice(0, 200) ?? null,
    googleMapsUrl: googleMapsSearchUrl(tags.name, { latitude, longitude }, address),
  };
}

async function fetchArea(lat: number, lng: number, radiusM: number): Promise<OsmPlace[]> {
  const query = `[out:json][timeout:8];(${SELECTORS.map((s) => `${s}(around:${radiusM},${lat},${lng});`).join("")});out center 200;`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetcher(OVERPASS_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT }, body: `data=${encodeURIComponent(query)}`, signal: controller.signal });
    if (!response.ok) { console.warn("[osmPlaces] overpass status", response.status); return []; }
    const body = (await response.json()) as { elements?: OverpassElement[] };
    return (body.elements ?? []).map(toPlace).filter((p): p is OsmPlace => Boolean(p));
  } catch (err) {
    console.warn("[osmPlaces] overpass error", (err as Error).name);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function distanceM(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const r = 6371000; const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude); const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/**
 * Service places within `radiusKm` (capped at 5 km) of a point, nearest first.
 * The area is fetched once per ~1 km cell and radius bucket and cached.
 */
export async function nearbyOsmPlaces(input: { latitude: number; longitude: number; radiusKm: number; query?: string }): Promise<OsmPlace[]> {
  const radiusM = Math.round(Math.min(Math.max(input.radiusKm, 0.5), 5) * 1000);
  const cellLat = Math.round(input.latitude * 100) / 100; const cellLng = Math.round(input.longitude * 100) / 100;
  const key = `${cellLat}:${cellLng}:${radiusM}`;
  let hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) {
    // One upstream request at a time (fair use); a waiting caller re-checks the cache.
    const run = inFlight.then(async () => {
      const again = cache.get(key);
      if (again && Date.now() - again.at <= CACHE_TTL_MS) return again;
      // Fetch around the cell centre with ~1 km slack so any point in the cell is covered.
      const places = await fetchArea(cellLat, cellLng, radiusM + 1000);
      const entry = { at: Date.now(), places };
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
      // Don't pin a failed (empty) lookup for a whole day.
      if (places.length) cache.set(key, entry);
      return entry;
    });
    inFlight = run.catch(() => undefined);
    hit = await run;
  }
  const origin = { latitude: input.latitude, longitude: input.longitude };
  const q = input.query?.trim().toLowerCase();
  return hit.places
    .map((place) => ({ place, d: distanceM(origin, place) }))
    .filter(({ place, d }) => d <= radiusM && (!q || place.name.toLowerCase().includes(q) || place.category.toLowerCase().includes(q)))
    .sort((a, b) => a.d - b.d)
    .slice(0, 60)
    .map(({ place }) => place);
}

/** Drops OSM places that are already on Chakusa (same spot within 60 m and a matching name). */
export function withoutChakusaDuplicates(places: OsmPlace[], businesses: Array<{ name: string; latitude: number | null; longitude: number | null }>): OsmPlace[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return places.filter((place) => !businesses.some((b) => {
    if (typeof b.latitude !== "number" || typeof b.longitude !== "number") return false;
    if (distanceM(place, { latitude: b.latitude, longitude: b.longitude }) > 60) return false;
    const a = norm(place.name); const c = norm(b.name);
    return a.includes(c) || c.includes(a);
  }));
}
