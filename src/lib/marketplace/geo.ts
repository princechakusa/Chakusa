// Great-circle distance for marketplace "near me" discovery. Coordinates are
// the business's own pinned location (BusinessMarketplaceListing) and a
// customer's one-off position sent with a single search - the customer's
// position is never stored.

const EARTH_RADIUS_KM = 6371;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export interface Coordinates { latitude: number; longitude: number }

export function haversineKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance rounded for display (0.1 km under 10 km, whole km beyond). */
export function displayDistanceKm(km: number): number {
  return km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
}
