import * as Location from 'expo-location';

// One-shot "where am I?" through Expo Location: Apple Core Location on iOS,
// Google's Fused Location Provider on Android, the browser's Geolocation API
// on web. Foreground permission only, a single fix per request - no
// watching, no background access, nothing persisted (see roadmap
// non-negotiable: no permanent live-location history).

export class LocationPermissionError extends Error {}
export class LocationUnavailableError extends Error {}

export async function currentPosition(): Promise<{ latitude: number; longitude: number; accuracyMeters: number | null }> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    throw new LocationPermissionError('Location permission is off. Search for a place or drop a pin on the map instead.');
  }
  try {
    const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracyMeters: position.coords.accuracy ?? null };
  } catch {
    throw new LocationUnavailableError('Could not find your location right now. Search for a place or drop a pin instead.');
  }
}
