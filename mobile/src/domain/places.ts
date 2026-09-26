// Pure helpers for turning geocoder output and distances into what people
// read. Kept free of React Native so they are unit-tested directly.

export interface Place {
  latitude: number;
  longitude: number;
  /** Short human label, e.g. "Avondale, Harare". */
  label: string;
  addressLine: string | null;
  city: string | null;
  region: string | null;
}

export interface NominatimResult {
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
  address?: Partial<Record<'house_number' | 'road' | 'pedestrian' | 'neighbourhood' | 'suburb' | 'quarter' | 'city_district' | 'village' | 'town' | 'city' | 'municipality' | 'county' | 'state' | 'region' | 'country', string>>;
}

export function placeFromNominatim(result: NominatimResult): Place {
  const a = result.address ?? {};
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county ?? null;
  const area = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district ?? null;
  const street = a.road ?? a.pedestrian ?? null;
  const addressLine = street ? [a.house_number, street].filter(Boolean).join(' ') : null;
  const region = a.state ?? a.region ?? null;
  const labelParts = [area && area !== city ? area : null, city ?? region ?? a.country ?? null].filter(Boolean) as string[];
  const fallback = result.name || result.display_name?.split(',').slice(0, 2).join(',').trim() || `${Number(result.lat).toFixed(4)}, ${Number(result.lon).toFixed(4)}`;
  return {
    latitude: Number(result.lat),
    longitude: Number(result.lon),
    label: labelParts.length ? labelParts.join(', ') : fallback,
    addressLine,
    city,
    region,
  };
}

/** "350 m away", "1.2 km away", "14 km away". */
export function distanceLabel(km: number | null | undefined): string | null {
  if (km === null || km === undefined || !Number.isFinite(km)) return null;
  if (km < 1) return `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m away`;
  return `${km < 10 ? km.toFixed(1).replace(/\.0$/, '') : Math.round(km)} km away`;
}

/** Directions to a point in OpenStreetMap (free, no key), opened in the browser or maps app. */
export function directionsUrl(latitude: number, longitude: number) {
  return `https://www.openstreetmap.org/directions?to=${latitude.toFixed(5)}%2C${longitude.toFixed(5)}#map=16/${latitude.toFixed(5)}/${longitude.toFixed(5)}`;
}
