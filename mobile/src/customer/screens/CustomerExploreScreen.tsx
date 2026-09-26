import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppHeader, EmptyState, ErrorState, FilterTabs, LoadingState, Screen, SearchBar } from '../../components/ui';
import { LeafletMap } from '../../components/map/LeafletMap';
import { LocationPicker } from '../../components/map/LocationPicker';
import type { MarketplaceCardDto, MarketplaceCategoryDto } from '../../apiTypes';
import type { Place } from '../../domain/places';
import { ApiError } from '../../services/api';
import { currentPosition } from '../../services/devicePosition';
import { reverseGeocode } from '../../services/geocoding';
import { colors, radius, spacing, typography } from '../../theme';
import { BusinessCard } from '../components/cards';
import { marketplaceApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;

// PROGRAM 2 LOOP 7: discovery. `/customer/marketplace` for the default
// feed, `/customer/marketplace/search` once the customer types, and the
// category list as quick filters. Read-only browsing - the profile screen
// owns favourite/follow/report.
//
// Near me: the customer's position (Expo Location, or a place they search /
// pin on the free OpenStreetMap map) is sent with each nearby search and
// kept only in this screen's memory - never stored on the server or device.

const RADII = [5, 15, 50] as const;
type Radius = (typeof RADII)[number];

export function CustomerExploreScreen() {
  const navigation = useNavigation<Nav>();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [categories, setCategories] = useState<MarketplaceCategoryDto[]>([]);
  const [items, setItems] = useState<MarketplaceCardDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [radiusKm, setRadiusKm] = useState<Radius>(15);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Place | null>(null);
  const [draftPending, setDraftPending] = useState(false);

  useEffect(() => {
    marketplaceApi.categories().then((res) => setCategories(res.categories.slice(0, 12))).catch(() => setCategories([]));
  }, []);

  const load = useCallback(async () => {
    setLoaded(false);
    try {
      const trimmed = term.trim();
      const selectedCategory = category === 'all' ? undefined : category;
      const page = origin
        ? await marketplaceApi.nearby(origin.latitude, origin.longitude, radiusKm, 30, { category: selectedCategory, q: trimmed.length >= 2 ? trimmed : undefined })
        : trimmed.length >= 2
          ? await marketplaceApi.search(trimmed, { category: selectedCategory })
          : await marketplaceApi.discover({ category: selectedCategory });
      setItems(page.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load businesses.');
    } finally {
      setLoaded(true);
    }
  }, [category, origin, radiusKm, term]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), term ? 350 : 0);
    return () => clearTimeout(handle);
  }, [load, term]);

  const useMyLocation = async () => {
    setLocating(true); setLocationError(null);
    try {
      const position = await currentPosition();
      const fallback: Place = { ...position, label: 'Your location', addressLine: null, city: null, region: null };
      setOrigin(fallback);
      // Name the area in the background; results don't wait for it.
      reverseGeocode(position.latitude, position.longitude).then((place) => setOrigin((current) => (current === fallback ? place : current))).catch(() => undefined);
    } catch (caught) {
      setLocationError(caught instanceof Error ? caught.message : 'Could not find your location.');
    } finally {
      setLocating(false);
    }
  };

  const filterOptions = useMemo(
    () => ['all', ...categories.map((c) => c.slug)] as const,
    [categories],
  );
  const categoryLabel = (slug: string) => slug === 'all' ? 'All' : categories.find((c) => c.slug === slug)?.name ?? slug;
  const mapped = items.filter((card) => typeof card.latitude === 'number' && typeof card.longitude === 'number');

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow="EXPLORE" title="Find a business" subtitle="Browse trusted local businesses on Chakusa." />
      <SearchBar value={term} onChangeText={setTerm} placeholder="Search businesses or services" />

      {origin ? (
        <View testID="near-me-active" style={styles.nearCard}>
          <View style={styles.nearRow}>
            <Ionicons name="navigate" size={18} color={colors.primary} />
            <View style={styles.nearCopy}>
              <Text style={styles.nearEyebrow}>NEAR</Text>
              <Text testID="near-me-label" style={styles.nearLabel} numberOfLines={1}>{origin.label}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Change location" onPress={() => { setDraft(origin); setPicking(true); }} hitSlop={8}><Text style={styles.link}>Change</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Stop searching near me" onPress={() => { setOrigin(null); setView('list'); }} hitSlop={8}><Ionicons name="close-circle" size={20} color={colors.textSecondary} /></Pressable>
          </View>
          <View style={styles.chips}>
            {RADII.map((km) => (
              <Pressable key={km} accessibilityRole="button" accessibilityState={{ selected: radiusKm === km }} accessibilityLabel={`Within ${km} km`} onPress={() => setRadiusKm(km)} style={[styles.chip, radiusKm === km && styles.chipActive]}>
                <Text style={[styles.chipText, radiusKm === km && styles.chipTextActive]}>{km} km</Text>
              </Pressable>
            ))}
            <View style={styles.flex} />
            <Pressable accessibilityRole="button" accessibilityLabel={view === 'list' ? 'Show on map' : 'Show as list'} onPress={() => setView(view === 'list' ? 'map' : 'list')} style={styles.chip}>
              <Ionicons name={view === 'list' ? 'map-outline' : 'list-outline'} size={14} color={colors.text} />
              <Text style={styles.chipText}>{view === 'list' ? 'Map' : 'List'}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.nearCard}>
          <Pressable testID="near-me" accessibilityRole="button" accessibilityLabel="Find businesses near me" disabled={locating} onPress={() => void useMyLocation()} style={({ pressed }) => [styles.nearRow, pressed && styles.pressed]}>
            {locating ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="locate" size={20} color={colors.primary} />}
            <View style={styles.nearCopy}>
              <Text style={styles.nearLabel}>{locating ? 'Finding you…' : 'Businesses near you'}</Text>
              <Text style={styles.nearHint}>Use your location - it is only used for this search.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose a place on the map" onPress={() => { setDraft(null); setPicking(true); }} hitSlop={6}>
            <Text style={styles.link}>Or choose a place on the map</Text>
          </Pressable>
          {locationError ? <Text accessibilityRole="alert" style={styles.error}>{locationError}</Text> : null}
        </View>
      )}

      {filterOptions.length > 1 ? (
        <View style={styles.filterWrap}>
          <FilterTabs options={filterOptions} value={category as (typeof filterOptions)[number]} onChange={(v) => setCategory(v)} />
        </View>
      ) : null}

      {!loaded ? <LoadingState label="Loading businesses…" />
        : error ? <ErrorState message={error} onRetry={() => void load()} />
        : !items.length ? (
          <EmptyState
            icon={origin ? 'navigate-outline' : 'search-outline'}
            title={origin ? `Nothing within ${radiusKm} km` : 'Nothing to show'}
            message={origin
              ? radiusKm < 50 ? 'Try a wider distance, or search another area.' : 'No businesses near this place have pinned their location yet.'
              : term.trim() ? `No results for “${term.trim()}”${category !== 'all' ? ` in ${categoryLabel(category)}` : ''}.` : 'No businesses are listed for this filter yet.'}
          />
        ) : (
          <View style={styles.list}>
            <Text style={styles.count}>{items.length} result{items.length === 1 ? '' : 's'}{origin ? ` within ${radiusKm} km · nearest first` : ''}</Text>
            {origin && view === 'map' ? (
              <LeafletMap
                height={300}
                center={origin}
                zoom={13}
                fitMarkers
                markers={[{ ...origin, kind: 'you', label: 'You' }, ...mapped.map((card) => ({ latitude: card.latitude!, longitude: card.longitude!, kind: 'business' as const, label: card.name }))]}
                accessibilityLabel="Businesses near you on the map"
              />
            ) : null}
            {items.map((card) => (
              <BusinessCard key={card.slug} card={card} onPress={() => navigation.navigate('BusinessProfile', { slug: card.slug })} />
            ))}
          </View>
        )}

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHead}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setPicking(false)} hitSlop={8}><Ionicons name="close" size={24} color={colors.text} /></Pressable>
            <Text style={styles.modalTitle}>Search near…</Text>
            <View style={styles.modalSpacer} />
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
            <LocationPicker value={draft} onChange={setDraft} onLookupChange={setDraftPending} mapHeight={320} hint="Tap the map to search around that spot." />
          </ScrollView>
          <View style={styles.modalFoot}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search here"
              disabled={!draft || draftPending}
              onPress={() => { if (draft) { setOrigin(draft); setLocationError(null); } setPicking(false); }}
              style={[styles.primary, (!draft || draftPending) && styles.disabled]}
            >
              <Text style={styles.primaryText}>Search here</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterWrap: { marginHorizontal: -spacing.lg, paddingLeft: spacing.lg },
  list: { gap: spacing.sm },
  count: { ...typography.caption, color: colors.textSecondary },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  nearCard: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  nearRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nearCopy: { flex: 1, gap: 2 },
  nearEyebrow: { ...typography.caption, fontSize: 11, letterSpacing: 1, color: colors.textSecondary },
  nearLabel: { ...typography.bodyStrong, color: colors.text },
  nearHint: { ...typography.caption, color: colors.textSecondary },
  link: { ...typography.bodyStrong, fontSize: 13, color: colors.primary },
  chips: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: radius.round, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { ...typography.caption, color: colors.text },
  chipTextActive: { color: colors.surface },
  error: { ...typography.caption, color: colors.negative },
  modal: { flex: 1, backgroundColor: colors.background },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  modalTitle: { ...typography.subheading, color: colors.text },
  modalSpacer: { width: 24 },
  modalBody: { padding: spacing.lg },
  modalFoot: { padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
  primary: { minHeight: 50, borderRadius: radius.round, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { ...typography.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.5 },
});
