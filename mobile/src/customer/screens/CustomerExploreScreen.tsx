import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LeafletMap } from '../../components/map/LeafletMap';
import { LocationPicker } from '../../components/map/LocationPicker';
import type { GooglePlaceDto, MarketplaceCardDto, MarketplaceCategoryDto } from '../../apiTypes';
import { distanceLabel, type Place } from '../../domain/places';
import { ApiError } from '../../services/api';
import { currentPosition, positionIfPermitted } from '../../services/devicePosition';
import { reverseGeocode } from '../../services/geocoding';
import { PhotoCarousel } from '../components/PhotoCarousel';
import { marketplaceApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';
import { premium, premiumSerif, premiumShadow, ratingText, reviewCountText } from '../premiumTheme';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;

// Explore: map first. Every Chakusa business with a pinned location is a
// rating pill on the map; a swipeable strip of photo cards along the bottom
// stays in sync with the selected pill. List view shows the same results as
// full photo cards plus, when Google Places is configured, "Also nearby on
// Google" (listed with attribution - never drawn on the OpenStreetMap map,
// per Google's terms).
//
// The customer's position is used only for the current search and kept in
// this screen's memory - never stored on the server or device.

const RADII = [5, 15, 50] as const;
type Radius = (typeof RADII)[number];

export function CustomerExploreScreen() {
  const navigation = useNavigation<Nav>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [categories, setCategories] = useState<MarketplaceCategoryDto[]>([]);
  const [items, setItems] = useState<MarketplaceCardDto[]>([]);
  const [google, setGoogle] = useState<GooglePlaceDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [radiusKm, setRadiusKm] = useState<Radius>(15);
  const [view, setView] = useState<'map' | 'list'>('map');
  const [selected, setSelected] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<Place | null>(null);
  const [draftPending, setDraftPending] = useState(false);
  const stripRef = useRef<FlatList<MarketplaceCardDto>>(null);

  const cardWidth = Math.min(width - 56, 360);

  useEffect(() => {
    marketplaceApi.categories().then((res) => setCategories(res.categories.slice(0, 12))).catch(() => setCategories([]));
    // Open on the customer's own area when they already allowed location.
    void positionIfPermitted().then((position) => {
      if (!position) return;
      setOrigin((current) => current ?? { ...position, label: 'Your area', addressLine: null, city: null, region: null });
    });
  }, []);

  const load = useCallback(async () => {
    setLoaded(false);
    try {
      const trimmed = term.trim();
      const selectedCategory = category === 'all' ? undefined : category;
      const page = origin
        ? await marketplaceApi.nearby(origin.latitude, origin.longitude, radiusKm, 40, { category: selectedCategory, q: trimmed.length >= 2 ? trimmed : undefined })
        : trimmed.length >= 2
          ? await marketplaceApi.search(trimmed, { category: selectedCategory })
          : await marketplaceApi.discover({ category: selectedCategory, limit: 40 });
      setItems(page.items);
      setSelected((current) => (current && page.items.some((card) => card.slug === current) ? current : page.items[0]?.slug ?? null));
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

  // Google's nearby places, only once there is a real position to search around.
  useEffect(() => {
    if (!origin) { setGoogle([]); return; }
    const trimmed = term.trim();
    const handle = setTimeout(() => {
      marketplaceApi.googleNearby(origin.latitude, origin.longitude, Math.min(radiusKm, 15), trimmed.length >= 2 ? trimmed : undefined)
        .then((res) => setGoogle(res.enabled ? res.places : []))
        .catch(() => setGoogle([]));
    }, 500);
    return () => clearTimeout(handle);
  }, [origin, radiusKm, term]);

  const useMyLocation = async () => {
    setLocating(true); setLocationError(null);
    try {
      const position = await currentPosition();
      const fallback: Place = { ...position, label: 'Your location', addressLine: null, city: null, region: null };
      setOrigin(fallback);
      reverseGeocode(position.latitude, position.longitude).then((place) => setOrigin((current) => (current === fallback ? place : current))).catch(() => undefined);
    } catch (caught) {
      setLocationError(caught instanceof Error ? caught.message : 'Could not find your location.');
    } finally {
      setLocating(false);
    }
  };

  const mapped = useMemo(() => items.filter((card) => typeof card.latitude === 'number' && typeof card.longitude === 'number'), [items]);
  const markers = useMemo(() => [
    ...(origin ? [{ latitude: origin.latitude, longitude: origin.longitude, kind: 'you' as const, label: 'You' }] : []),
    ...mapped.map((card) => ({ latitude: card.latitude!, longitude: card.longitude!, kind: 'business' as const, key: card.slug, label: card.name, badge: ratingText(card.rating) ?? undefined })),
  ], [mapped, origin]);
  const center = origin ?? (mapped[0] ? { latitude: mapped[0].latitude!, longitude: mapped[0].longitude! } : null);

  const selectFromMap = (slug: string) => {
    setSelected(slug);
    const index = mapped.findIndex((card) => card.slug === slug);
    if (index >= 0) stripRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  };
  const open = (slug: string) => navigation.navigate('BusinessProfile', { slug });
  const categoryLabel = (slug: string) => slug === 'all' ? 'All' : categories.find((c) => c.slug === slug)?.name ?? slug;
  const showMap = view === 'map' && Boolean(center);

  const searchBar = (
    <View style={[styles.searchRow, premiumShadow]}>
      <Ionicons name="search" size={18} color={premium.inkFaint} />
      <TextInput
        accessibilityLabel="Search businesses or services"
        value={term}
        onChangeText={setTerm}
        placeholder="Search salons, barbers, spas…"
        placeholderTextColor={premium.inkFaint}
        style={styles.searchInput}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
      <Pressable testID="near-me" accessibilityRole="button" accessibilityLabel={origin ? 'Change location' : 'Find businesses near me'} onPress={() => (origin ? (setDraft(origin), setPicking(true)) : void useMyLocation())} hitSlop={8} style={styles.searchAction}>
        {locating ? <ActivityIndicator color={premium.deep} size="small" /> : <Ionicons name={origin ? 'navigate' : 'locate'} size={18} color={premium.deep} />}
      </Pressable>
    </View>
  );

  const areaChip = origin ? (
    <View style={styles.areaRow}>
      <View style={[styles.areaChip, premiumShadow]}>
        <Ionicons name="navigate" size={13} color={premium.deep} />
        <Text testID="near-me-label" style={styles.areaText} numberOfLines={1}>Near {origin.label}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Stop searching near me" onPress={() => setOrigin(null)} hitSlop={8}>
          <Ionicons name="close-circle" size={16} color={premium.inkFaint} />
        </Pressable>
      </View>
    </View>
  ) : null;

  const filters = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
      {origin ? RADII.map((km) => (
        <Pressable key={km} accessibilityRole="button" accessibilityState={{ selected: radiusKm === km }} accessibilityLabel={`Within ${km} km`} onPress={() => setRadiusKm(km)} style={[styles.chip, radiusKm === km && styles.chipActive]}>
          <Text style={[styles.chipText, radiusKm === km && styles.chipTextActive]}>{km} km</Text>
        </Pressable>
      )) : null}
      {['all', ...categories.map((c) => c.slug)].map((option) => (
        <Pressable key={option} accessibilityRole="button" accessibilityState={{ selected: category === option }} onPress={() => setCategory(option)} style={[styles.chip, category === option && styles.chipActive]}>
          <Text style={[styles.chipText, category === option && styles.chipTextActive]}>{categoryLabel(option)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );

  const viewToggle = (
    <Pressable accessibilityRole="button" accessibilityLabel={view === 'map' ? 'Show as list' : 'Show on map'} onPress={() => setView(view === 'map' ? 'list' : 'map')} style={[styles.toggle, premiumShadow]}>
      <Ionicons name={view === 'map' ? 'list' : 'map'} size={16} color={premium.onDeep} />
      <Text style={styles.toggleText}>{view === 'map' ? 'List' : 'Map'}</Text>
    </Pressable>
  );

  return (
    <View style={styles.screen}>
      {showMap ? (
        <>
          <LeafletMap
            fill
            center={center!}
            zoom={13}
            fitMarkers={!origin && mapped.length > 1}
            markers={markers}
            selectedKey={selected}
            onSelect={selectFromMap}
            accessibilityLabel="Businesses on the map"
          />
          <View pointerEvents="box-none" style={[styles.overlayTop, { paddingTop: insets.top + 8 }]}>
            {searchBar}
            {areaChip}
            {filters}
            {locationError ? <Text accessibilityRole="alert" style={styles.errorPill}>{locationError}</Text> : null}
          </View>
          <View pointerEvents="box-none" style={styles.overlayBottom}>
            <View pointerEvents="box-none" style={styles.bottomBar}>
              {!loaded ? <View style={styles.loadingPill}><ActivityIndicator color={premium.deep} size="small" /><Text style={styles.loadingText}>Finding businesses…</Text></View> : <View />}
              {viewToggle}
            </View>
            {error ? <Text accessibilityRole="alert" style={styles.errorPill}>{error}</Text> : null}
            {loaded && !error && !mapped.length ? (
              <View style={[styles.emptyCard, premiumShadow]}>
                <Text style={styles.emptyTitle}>{origin ? `Nothing within ${radiusKm} km yet` : 'No businesses on the map yet'}</Text>
                <Text style={styles.emptyBody}>{origin && radiusKm < 50 ? 'Try a wider distance or another area.' : 'Switch to the list to see every business.'}</Text>
              </View>
            ) : null}
            {mapped.length ? (
              <FlatList
                ref={stripRef}
                horizontal
                data={mapped}
                keyExtractor={(card) => card.slug}
                showsHorizontalScrollIndicator={false}
                snapToInterval={cardWidth + 12}
                decelerationRate="fast"
                contentContainerStyle={styles.strip}
                getItemLayout={(_, index) => ({ length: cardWidth + 12, offset: (cardWidth + 12) * index, index })}
                onScrollToIndexFailed={() => undefined}
                onMomentumScrollEnd={(event) => {
                  const index = Math.round(event.nativeEvent.contentOffset.x / (cardWidth + 12));
                  const card = mapped[Math.max(0, Math.min(index, mapped.length - 1))];
                  if (card) setSelected(card.slug);
                }}
                renderItem={({ item }) => <MapCard card={item} width={cardWidth} selected={item.slug === selected} onPress={() => open(item.slug)} />}
              />
            ) : null}
          </View>
        </>
      ) : (
        <ScrollView contentContainerStyle={[styles.listContent, { paddingTop: insets.top + 8 }]} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>EXPLORE</Text>
          <Text style={styles.title}>Discover <Text style={styles.titleSerif}>near you.</Text></Text>
          {searchBar}
          {areaChip}
          {filters}
          {!origin ? (
            <Pressable accessibilityRole="button" onPress={() => void useMyLocation()} style={styles.nearPrompt}>
              <Ionicons name="locate" size={18} color={premium.deep} />
              <Text style={styles.nearPromptText}>{locating ? 'Finding you…' : 'Show businesses near me on the map'}</Text>
              <Ionicons name="chevron-forward" size={16} color={premium.inkFaint} />
            </Pressable>
          ) : null}
          {locationError ? <Text accessibilityRole="alert" style={styles.errorText}>{locationError}</Text> : null}
          {!loaded ? <ActivityIndicator style={styles.spinner} color={premium.deep} />
            : error ? <Text accessibilityRole="alert" style={styles.errorText}>{error}</Text>
            : !items.length ? (
              <View style={styles.emptyList}>
                <Text style={styles.emptyTitle}>{term.trim() ? `No results for “${term.trim()}”` : 'Nothing listed here yet'}</Text>
                <Text style={styles.emptyBody}>Try another search or category.</Text>
              </View>
            ) : (
              <View style={styles.list}>
                <Text style={styles.count}>{items.length} on Chakusa{origin ? ` · within ${radiusKm} km` : ''}</Text>
                {items.map((card) => <ListCard key={card.slug} card={card} width={width - 32} onPress={() => open(card.slug)} />)}
              </View>
            )}
          {google.length ? (
            <View style={styles.googleSection}>
              <Text style={styles.sectionTitle}>Also nearby</Text>
              <Text style={styles.googleNote}>Not on Chakusa yet · ratings from Google</Text>
              {google.map((place) => <GooglePlaceRow key={place.placeId} place={place} />)}
            </View>
          ) : null}
          {center ? <View style={styles.listToggle}>{viewToggle}</View> : null}
        </ScrollView>
      )}

      <Modal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHead}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setPicking(false)} hitSlop={8}><Ionicons name="close" size={24} color={premium.ink} /></Pressable>
            <Text style={styles.modalTitle}>Search near…</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Use my location" onPress={() => { setPicking(false); void useMyLocation(); }} hitSlop={8}><Ionicons name="locate" size={22} color={premium.deep} /></Pressable>
          </View>
          <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <LocationPicker value={draft} onChange={setDraft} onLookupChange={setDraftPending} mapHeight={320} hint="Tap the map to search around that spot." />
            </ScrollView>
            <View style={styles.modalFoot}>
              <Pressable accessibilityRole="button" accessibilityLabel="Search here" disabled={!draft || draftPending} onPress={() => { if (draft) { setOrigin(draft); setLocationError(null); } setPicking(false); }} style={[styles.primary, (!draft || draftPending) && styles.disabled]}>
                <Text style={styles.primaryText}>Search here</Text>
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function Rating({ card, light = false }: { card: MarketplaceCardDto; light?: boolean }) {
  const value = ratingText(card.rating);
  return value ? (
    <View style={styles.ratingRow}>
      <Ionicons name="star" size={12} color={premium.gold} />
      <Text style={[styles.ratingValue, light && styles.onDeep]}>{value}</Text>
      <Text style={[styles.ratingCount, light && styles.onDeepSoft]}>({reviewCountText(card.reviewCount)})</Text>
    </View>
  ) : <Text style={[styles.newBadge, light && styles.onDeepSoft]}>New on Chakusa</Text>;
}

function MapCard({ card, width, selected, onPress }: { card: MarketplaceCardDto; width: number; selected: boolean; onPress: () => void }) {
  const photos = card.photos?.length ? card.photos : [card.photo ?? card.photoUrl].filter((p): p is string => Boolean(p));
  const distance = distanceLabel(card.distanceKm);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${card.name}, ${card.category}. Open`} onPress={onPress} style={[styles.mapCard, { width }, selected && styles.mapCardSelected, premiumShadow]}>
      <PhotoCarousel photos={photos.slice(0, 1)} name={card.name} width={104} height={118} radius={14} />
      <View style={styles.mapCardBody}>
        <Text style={styles.cardName} numberOfLines={1}>{card.name}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>{card.category}{distance ? ` · ${distance}` : card.city ? ` · ${card.city}` : ''}</Text>
        <Rating card={card} />
        <View style={styles.cardActions}>
          {card.acceptsOnlineBooking ? <View style={styles.bookPill}><Text style={styles.bookPillText}>Book</Text></View> : null}
          {card.verified ? <Ionicons name="shield-checkmark" size={15} color={premium.deepSoft} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

function ListCard({ card, width, onPress }: { card: MarketplaceCardDto; width: number; onPress: () => void }) {
  const photos = card.photos?.length ? card.photos : [card.photo ?? card.photoUrl].filter((p): p is string => Boolean(p));
  const distance = distanceLabel(card.distanceKm);
  return (
    <View style={[styles.listCard, premiumShadow]}>
      <PhotoCarousel photos={photos} name={card.name} width={width} height={Math.round(width * 0.58)} />
      {card.verified ? <View style={styles.verified}><Ionicons name="shield-checkmark" size={12} color={premium.onDeep} /><Text style={styles.verifiedText}>Verified</Text></View> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`${card.name}. Open`} onPress={onPress} style={styles.listBody}>
        <View style={styles.flex}>
          <Text style={styles.listName} numberOfLines={1}>{card.name}</Text>
          <Text style={styles.cardMeta} numberOfLines={1}>{card.category}{distance ? ` · ${distance}` : card.city ? ` · ${card.city}` : ''}</Text>
          {card.tagline ? <Text style={styles.tagline} numberOfLines={2}>{card.tagline}</Text> : null}
          <Rating card={card} />
        </View>
        <View style={styles.listCta}><Ionicons name="arrow-forward" size={17} color={premium.onDeep} /></View>
      </Pressable>
    </View>
  );
}

function GooglePlaceRow({ place }: { place: GooglePlaceDto }) {
  return (
    <Pressable accessibilityRole="link" accessibilityLabel={`${place.name}. Open in Google Maps`} disabled={!place.mapsUrl} onPress={() => place.mapsUrl && void Linking.openURL(place.mapsUrl)} style={styles.googleRow}>
      <View style={styles.flex}>
        <Text style={styles.googleName} numberOfLines={1}>{place.name}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>{[place.category, place.address].filter(Boolean).join(' · ')}</Text>
        {place.rating != null ? (
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={12} color={premium.gold} />
            <Text style={styles.ratingValue}>{place.rating.toFixed(1)}</Text>
            <Text style={styles.ratingCount}>({reviewCountText(place.reviewCount)}) on Google</Text>
          </View>
        ) : null}
      </View>
      <Ionicons name="open-outline" size={16} color={premium.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: premium.bg },
  flex: { flex: 1 },
  overlayTop: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, gap: 10 },
  overlayBottom: { position: 'absolute', bottom: 12, left: 0, right: 0, gap: 10 },
  bottomBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, borderRadius: 26, backgroundColor: premium.card, paddingLeft: 18, paddingRight: 6, borderWidth: 1, borderColor: premium.line },
  searchInput: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 15, color: premium.ink, paddingVertical: 12, outlineStyle: 'none' } as never,
  searchAction: { width: 40, height: 40, borderRadius: 20, backgroundColor: premium.sageSoft, alignItems: 'center', justifyContent: 'center' },
  filters: { gap: 8, paddingRight: 16 },
  areaRow: { flexDirection: 'row' },
  areaChip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', backgroundColor: premium.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1, borderColor: premium.line },
  areaText: { flexShrink: 1, fontFamily: 'Inter_600SemiBold', fontSize: 12, color: premium.ink },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: premium.card, borderWidth: 1, borderColor: premium.line },
  chipActive: { backgroundColor: premium.deep, borderColor: premium.deep },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: premium.ink },
  chipTextActive: { color: premium.onDeep },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: premium.deep, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  toggleText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: premium.onDeep },
  loadingPill: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: premium.card, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999 },
  loadingText: { fontFamily: 'Inter_500Medium', fontSize: 12, color: premium.inkSoft },
  errorPill: { alignSelf: 'center', marginHorizontal: 16, backgroundColor: premium.card, color: premium.danger, fontFamily: 'Inter_500Medium', fontSize: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, overflow: 'hidden' },
  strip: { paddingHorizontal: 16, gap: 12 },
  mapCard: { flexDirection: 'row', gap: 12, padding: 10, borderRadius: 22, backgroundColor: premium.card, borderWidth: 1, borderColor: premium.line },
  mapCardSelected: { borderColor: premium.deep, borderWidth: 1.5 },
  mapCardBody: { flex: 1, gap: 4, paddingVertical: 4 },
  cardName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, letterSpacing: -0.3, color: premium.ink },
  cardMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: premium.inkSoft, textTransform: 'capitalize' },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 'auto' },
  bookPill: { backgroundColor: premium.deep, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999 },
  bookPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: premium.onDeep },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingValue: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 13, color: premium.ink },
  ratingCount: { fontFamily: 'Inter_400Regular', fontSize: 12, color: premium.inkFaint },
  newBadge: { fontFamily: 'Inter_500Medium', fontSize: 12, color: premium.deepSoft },
  onDeep: { color: premium.onDeep },
  onDeepSoft: { color: premium.onDeepSoft },
  emptyCard: { marginHorizontal: 16, padding: 16, borderRadius: 20, backgroundColor: premium.card, gap: 4 },
  emptyTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.ink },
  emptyBody: { fontFamily: 'Inter_400Regular', fontSize: 13, color: premium.inkSoft },
  listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 12 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1.6, color: premium.inkFaint },
  title: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 30, letterSpacing: -1, color: premium.ink },
  titleSerif: { fontFamily: premiumSerif, fontStyle: 'italic', fontWeight: '400', fontSize: 34 },
  nearPrompt: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 18, backgroundColor: premium.sageSoft, borderWidth: 1, borderColor: premium.line },
  nearPromptText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14, color: premium.ink },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: premium.danger },
  spinner: { marginTop: 32 },
  emptyList: { paddingVertical: 32, alignItems: 'center', gap: 4 },
  list: { gap: 16 },
  count: { fontFamily: 'Inter_500Medium', fontSize: 12, color: premium.inkFaint },
  listCard: { borderRadius: 24, backgroundColor: premium.card, overflow: 'hidden', borderWidth: 1, borderColor: premium.line },
  verified: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(24,47,45,0.88)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  verifiedText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: premium.onDeep },
  listBody: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  listName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, letterSpacing: -0.4, color: premium.ink },
  tagline: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, color: premium.inkSoft, marginVertical: 4 },
  listCta: { width: 42, height: 42, borderRadius: 21, backgroundColor: premium.deep, alignItems: 'center', justifyContent: 'center' },
  googleSection: { gap: 4, marginTop: 8, padding: 16, borderRadius: 22, backgroundColor: premium.card, borderWidth: 1, borderColor: premium.line },
  sectionTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: premium.ink },
  googleNote: { fontFamily: 'Inter_400Regular', fontSize: 12, color: premium.inkFaint, marginBottom: 6 },
  googleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: premium.line },
  googleName: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: premium.ink },
  listToggle: { alignItems: 'center', marginTop: 8 },
  modal: { flex: 1, backgroundColor: premium.bg },
  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  modalTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: premium.ink },
  modalBody: { padding: 20 },
  modalFoot: { padding: 20, borderTopWidth: 1, borderTopColor: premium.line },
  primary: { minHeight: 52, borderRadius: 999, backgroundColor: premium.deep, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.onDeep },
  disabled: { opacity: 0.5 },
});
