import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import { LeafletMap } from '../../components/map/LeafletMap';
import { LocationPicker } from '../../components/map/LocationPicker';
import type { MarketplaceCardDto, MarketplaceCategoryDto } from '../../apiTypes';
import type { Place } from '../../domain/places';
import { authColors, authRadius, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { currentPosition } from '../../services/devicePosition';
import { reverseGeocode } from '../../services/geocoding';
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
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

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
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>EXPLORE</Text>
        <Text style={styles.title}>Find a business</Text>
        <Text style={styles.subtitle}>Browse trusted local businesses on Chakusa.</Text>
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={18} color={authColors.inkFaint} />
        <TextInput
          accessibilityLabel="Search businesses or services"
          value={term}
          onChangeText={setTerm}
          placeholder="Search businesses or services"
          placeholderTextColor={authColors.inkFaint}
          style={styles.searchInput}
          clearButtonMode="while-editing"
        />
      </View>

      {origin ? (
        <View testID="near-me-active" style={styles.nearCard}>
          <View style={styles.nearRow}>
            <Ionicons name="navigate" size={18} color={authColors.coral} />
            <View style={styles.nearCopy}>
              <Text style={styles.nearEyebrow}>NEAR</Text>
              <Text testID="near-me-label" style={styles.nearLabel} numberOfLines={1}>{origin.label}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Change location" onPress={() => { setDraft(origin); setPicking(true); }} hitSlop={8}><Text style={styles.link}>Change</Text></Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Stop searching near me" onPress={() => { setOrigin(null); setView('list'); }} hitSlop={8}><Ionicons name="close-circle" size={20} color={authColors.inkFaint} /></Pressable>
          </View>
          <View style={styles.chips}>
            {RADII.map((km) => (
              <Pressable key={km} accessibilityRole="button" accessibilityState={{ selected: radiusKm === km }} accessibilityLabel={`Within ${km} km`} onPress={() => setRadiusKm(km)} style={[styles.chip, radiusKm === km && styles.chipActive]}>
                <Text style={[styles.chipText, radiusKm === km && styles.chipTextActive]}>{km} km</Text>
              </Pressable>
            ))}
            <View style={styles.flex} />
            <Pressable accessibilityRole="button" accessibilityLabel={view === 'list' ? 'Show on map' : 'Show as list'} onPress={() => setView(view === 'list' ? 'map' : 'list')} style={styles.chip}>
              <Ionicons name={view === 'list' ? 'map-outline' : 'list-outline'} size={14} color={authColors.ink} />
              <Text style={styles.chipText}>{view === 'list' ? 'Map' : 'List'}</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.nearCard}>
          <Pressable testID="near-me" accessibilityRole="button" accessibilityLabel="Find businesses near me" disabled={locating} onPress={() => void useMyLocation()} style={({ pressed }) => [styles.nearRow, pressed && styles.pressed]}>
            {locating ? <ActivityIndicator color={authColors.coral} /> : <Ionicons name="locate" size={20} color={authColors.coral} />}
            <View style={styles.nearCopy}>
              <Text style={styles.nearLabel}>{locating ? 'Finding you…' : 'Businesses near you'}</Text>
              <Text style={styles.nearHint}>Use your location - it is only used for this search.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={authColors.inkFaint} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Choose a place on the map" onPress={() => { setDraft(null); setPicking(true); }} hitSlop={6}>
            <Text style={styles.link}>Or choose a place on the map</Text>
          </Pressable>
          {locationError ? <Text accessibilityRole="alert" style={styles.error}>{locationError}</Text> : null}
        </View>
      )}

      {filterOptions.length > 1 ? (
        <View style={styles.filterWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
            {filterOptions.map((option) => (
              <Pressable key={option} onPress={() => setCategory(option)} style={[styles.filter, category === option && styles.filterActive]}>
                <Text style={[styles.filterText, category === option && styles.filterTextActive]}>{categoryLabel(option)}</Text>
              </Pressable>
            ))}
          </ScrollView>
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
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setPicking(false)} hitSlop={8}><Ionicons name="close" size={24} color={authColors.ink} /></Pressable>
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
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  search: { flexDirection: 'row', alignItems: 'center', gap: authSpace.xs, minHeight: 48, borderRadius: authRadius.md, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, paddingHorizontal: authSpace.sm, marginBottom: authSpace.sm },
  searchInput: { flex: 1, ...authType.body, fontSize: 15, color: authColors.ink, paddingVertical: authSpace.sm, outlineStyle: 'none' } as never,
  filterWrap: { marginHorizontal: -authSpace.md, paddingLeft: authSpace.md, marginBottom: authSpace.xs },
  filters: { gap: authSpace.xs, paddingRight: authSpace.md },
  filter: { paddingHorizontal: authSpace.sm, paddingVertical: 8, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface },
  filterActive: { backgroundColor: authColors.coral, borderColor: authColors.coral },
  filterText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: authColors.ink },
  filterTextActive: { color: authColors.onCoral },
  list: { gap: authSpace.sm },
  count: { ...authType.body, fontSize: 12 },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  nearCard: { gap: authSpace.sm, padding: authSpace.md, borderRadius: authRadius.lg, backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.line, marginBottom: authSpace.sm },
  nearRow: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm },
  nearCopy: { flex: 1, gap: 2 },
  nearEyebrow: { ...authType.micro, fontSize: 10 },
  nearLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  nearHint: { ...authType.body, fontSize: 12 },
  link: { ...authType.link },
  chips: { flexDirection: 'row', alignItems: 'center', gap: authSpace.xs },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: authSpace.sm, paddingVertical: 6, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.bgSunk },
  chipActive: { backgroundColor: authColors.coral, borderColor: authColors.coral },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: authColors.ink },
  chipTextActive: { color: authColors.onCoral },
  error: { ...authType.body, fontSize: 12, color: authColors.danger },
  modal: { flex: 1, backgroundColor: authColors.bg },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: authSpace.lg, paddingVertical: authSpace.sm },
  modalTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: authColors.ink },
  modalSpacer: { width: 24 },
  modalBody: { padding: authSpace.lg },
  modalFoot: { padding: authSpace.lg, borderTopWidth: 1, borderTopColor: authColors.line },
  primary: { minHeight: 50, borderRadius: authRadius.pill, backgroundColor: authColors.coral, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.onCoral },
  disabled: { opacity: 0.5 },
});
