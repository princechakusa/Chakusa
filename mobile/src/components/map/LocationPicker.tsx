import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Place } from '../../domain/places';
import { currentPosition } from '../../services/devicePosition';
import { GeocodingError, reverseGeocode, searchPlaces } from '../../services/geocoding';
import { colors, radius, spacing, typography } from '../../theme';
import { LeafletMap } from './LeafletMap';

// Three ways to say "here": the device's position, a place search, or a pin
// dropped on the map. Whatever is chosen is turned into a readable area name
// with Nominatim and handed to `onChange`; storing it is the caller's call.

// Used only to centre an empty map; the app's default market is Zimbabwe.
const DEFAULT_CENTER = { latitude: -17.8292, longitude: 31.0522 };

export function LocationPicker({ value, onChange, onLookupChange, mapHeight = 220, hint }: {
  value: Place | null;
  onChange: (place: Place) => void;
  /** True while a chosen point is still being turned into an address - callers hold Save until it settles. */
  onLookupChange?: (pending: boolean) => void;
  mapHeight?: number;
  hint?: string;
}) {
  const [busy, setBusy] = useState<'locating' | 'searching' | 'naming' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const naming = useRef(0);
  const lookupRef = useRef(onLookupChange);
  lookupRef.current = onLookupChange;
  useEffect(() => { lookupRef.current?.(busy === 'naming' || busy === 'locating'); }, [busy]);

  const choose = async (latitude: number, longitude: number, provisional: string) => {
    const ticket = ++naming.current;
    onChange({ latitude, longitude, label: provisional, addressLine: null, city: null, region: null });
    setBusy('naming');
    try {
      const place = await reverseGeocode(latitude, longitude);
      if (ticket === naming.current) onChange(place);
    } catch (caught) {
      if (ticket === naming.current) setError(caught instanceof GeocodingError ? caught.message : 'Could not look up that address.');
    } finally {
      if (ticket === naming.current) setBusy(null);
    }
  };

  const useDevice = async () => {
    setError(null); setResults([]); setBusy('locating');
    try {
      const position = await currentPosition();
      await choose(position.latitude, position.longitude, 'Your current location');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not find your location.');
      setBusy(null);
    }
  };

  useEffect(() => {
    const text = query.trim();
    if (text.length < 3) { setResults([]); return; }
    const handle = setTimeout(async () => {
      setBusy('searching'); setError(null);
      try {
        const found = await searchPlaces(text);
        setResults(found);
        if (!found.length) setError(`No places found for “${text}”.`);
      } catch (caught) {
        setError(caught instanceof GeocodingError ? caught.message : 'Search failed.');
      } finally {
        setBusy(null);
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [query]);

  const center = value ?? DEFAULT_CENTER;
  return (
    <View style={styles.wrap}>
      <Pressable testID="location-use-device" accessibilityRole="button" onPress={() => void useDevice()} disabled={busy === 'locating'} style={({ pressed }) => [styles.deviceButton, pressed && styles.pressed]}>
        {busy === 'locating' ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="locate" size={18} color={colors.primary} />}
        <Text style={styles.deviceText}>{busy === 'locating' ? 'Finding you…' : 'Use my current location'}</Text>
      </Pressable>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.textSecondary} />
        <TextInput
          accessibilityLabel="Search for a place"
          placeholder="Search a street, area or town"
          placeholderTextColor={colors.textSecondary}
          value={query}
          onChangeText={setQuery}
          style={styles.searchInput}
          autoCorrect={false}
        />
        {busy === 'searching' ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      </View>
      {results.length ? (
        <View style={styles.results}>
          {results.map((place) => (
            <Pressable key={`${place.latitude},${place.longitude}`} accessibilityRole="button" onPress={() => { setResults([]); setQuery(''); onChange(place); }} style={({ pressed }) => [styles.result, pressed && styles.pressed]}>
              <Ionicons name="location-outline" size={16} color={colors.primary} />
              <Text style={styles.resultText} numberOfLines={2}>{place.label}{place.region && place.region !== place.city ? ` · ${place.region}` : ''}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <LeafletMap
        height={mapHeight}
        center={center}
        zoom={value ? 15 : 12}
        pickable
        markers={value ? [{ ...value, kind: 'pin', label: value.label }] : []}
        onPick={(point) => { setError(null); void choose(point.latitude, point.longitude, 'Dropped pin'); }}
        accessibilityLabel="Map - tap to drop a pin"
      />
      <Text style={styles.hint}>{hint ?? 'Tap the map to drop a pin exactly where you are.'}</Text>

      {value ? (
        <View testID="location-selected" style={styles.selected}>
          <Ionicons name="location" size={18} color={colors.primary} />
          <View style={styles.selectedCopy}>
            <Text style={styles.selectedLabel}>{value.label}</Text>
            <Text style={styles.selectedMeta}>{busy === 'naming' ? 'Looking up the address…' : [value.addressLine, value.region].filter(Boolean).join(' · ') || `${value.latitude.toFixed(4)}, ${value.longitude.toFixed(4)}`}</Text>
          </View>
        </View>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  deviceButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface },
  deviceText: { ...typography.bodyStrong, color: colors.primary },
  pressed: { opacity: 0.75 },
  searchRow: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  searchInput: { flex: 1, minHeight: 44, ...typography.body, color: colors.text },
  results: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  result: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  resultText: { ...typography.body, color: colors.text, flex: 1 },
  hint: { ...typography.caption, color: colors.textSecondary },
  selected: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.background },
  selectedCopy: { flex: 1, gap: 2 },
  selectedLabel: { ...typography.bodyStrong, color: colors.text },
  selectedMeta: { ...typography.caption, color: colors.textSecondary },
  error: { ...typography.caption, color: colors.negative },
});
