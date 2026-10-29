import { Ionicons } from '../../components/icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LeafletMap } from '../../components/map/LeafletMap';
import { LocationPicker } from '../../components/map/LocationPicker';
import type { MarketplaceCardDto, MarketplaceCategoryDto, NearbyPlaceDto } from '../../apiTypes';
import { distanceLabel, type Place } from '../../domain/places';
import { ApiError } from '../../services/api';
import { currentPosition, positionIfPermitted } from '../../services/devicePosition';
import { reverseGeocode } from '../../services/geocoding';
import { PhotoCarousel } from '../components/PhotoCarousel';
import { marketplaceApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';
import { premium, premiumSerif, premiumShadow, ratingText, reviewCountText } from '../premiumTheme';
import { KeyboardModal } from '../../components/KeyboardModal';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;

// Explore: map first. Every Chakusa business with a pinned location is a
// rating pill on the map; a swipeable strip of photo cards along the bottom
// stays in sync with the selected pill. List view shows the same results as
// full photo cards. Nearby service places that are not on Chakusa yet come
// free from OpenStreetMap (grey pins, "© OpenStreetMap contributors"); each
// opens in Google Maps through a plain Maps link (no API, no cost) and can be
// invited to Chakusa.
//
// The customer's position is used only for the current search and kept in
// this screen's memory - never stored on the server or device.

const RADII = [5, 15, 50] as const;
type Radius = (typeof RADII)[number];

// Where the map opens when the customer has not shared a location.
const DEFAULT_CENTER = { latitude: -17.8292, longitude: 31.0522 };

export function CustomerExploreScreen() {
  const navigation = useNavigation<Nav>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [categories, setCategories] = useState<MarketplaceCategoryDto[]>([]);
  const [items, setItems] = useState<MarketplaceCardDto[]>([]);
  const [places, setPlaces] = useState<NearbyPlaceDto[]>([]);
  const [placeOpen, setPlaceOpen] = useState<NearbyPlaceDto | null>(null);
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
  const stripRef = useRef<FlatList<StripEntry>>(null);

  const cardWidth = Math.min(width - 56, 360);

  useEffect(() => {
    marketplaceApi.categories().then((res) => setCategories(res.categories.slice(0, 12))).catch(() => setCategories([]));
    // Explore opens on the map around the customer: use the location if it is
    // already allowed, otherwise ask once now (declining keeps the map, centred
    // on Harare, where Chakusa businesses are).
    void positionIfPermitted().then((position) => {
      if (position) setOrigin((current) => current ?? { ...position, label: 'Your area', addressLine: null, city: null, region: null });
      else void useMyLocation();
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

  // Free nearby places (OpenStreetMap), once there is a real position.
  useEffect(() => {
    if (!origin) { setPlaces([]); return; }
    const trimmed = term.trim();
    const handle = setTimeout(() => {
      marketplaceApi.nearbyPlaces(origin.latitude, origin.longitude, Math.min(radiusKm, 5), trimmed.length >= 2 ? trimmed : undefined)
        .then((res) => setPlaces(res.places))
        .catch(() => setPlaces([]));
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
    ...places.map((place) => ({ latitude: place.latitude, longitude: place.longitude, kind: 'business' as const, key: `osm:${place.id}`, label: place.name, muted: true })),
    ...mapped.map((card) => ({ latitude: card.latitude!, longitude: card.longitude!, kind: 'business' as const, key: card.slug, label: card.name, badge: ratingText(card.rating) ?? undefined })),
  ], [mapped, origin, places]);
  // Map strip: Chakusa businesses first, then free nearby places.
  const strip = useMemo<StripEntry[]>(() => [
    ...mapped.map((card) => ({ key: card.slug, card })),
    ...places.map((place) => ({ key: `osm:${place.id}`, place })),
  ], [mapped, places]);
  const center = origin ?? (mapped[0] ? { latitude: mapped[0].latitude!, longitude: mapped[0].longitude! } : DEFAULT_CENTER);

  const selectFromMap = (key: string) => {
    setSelected(key);
    const index = strip.findIndex((entry) => entry.key === key);
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
            {loaded && !error && !strip.length ? (
              <View style={[styles.emptyCard, premiumShadow]}>
                <Text style={styles.emptyTitle}>{origin ? `Nothing within ${radiusKm} km yet` : 'No businesses on the map yet'}</Text>
                <Text style={styles.emptyBody}>{origin && radiusKm < 50 ? 'Try a wider distance or another area.' : 'Switch to the list to see every business.'}</Text>
              </View>
            ) : null}
            {places.length ? <Text style={styles.mapCredit}>Places {OSM_CREDIT}</Text> : null}
            {strip.length ? (
              <FlatList
                ref={stripRef}
                horizontal
                data={strip}
                keyExtractor={(entry) => entry.key}
                showsHorizontalScrollIndicator={false}
                snapToInterval={cardWidth + 12}
                decelerationRate="fast"
                contentContainerStyle={styles.strip}
                getItemLayout={(_, index) => ({ length: cardWidth + 12, offset: (cardWidth + 12) * index, index })}
                onScrollToIndexFailed={() => undefined}
                onMomentumScrollEnd={(event) => {
                  const index = Math.round(event.nativeEvent.contentOffset.x / (cardWidth + 12));
                  const entry = strip[Math.max(0, Math.min(index, strip.length - 1))];
                  if (entry) setSelected(entry.key);
                }}
                renderItem={({ item }) => item.card
                  ? <MapCard card={item.card} width={cardWidth} selected={item.key === selected} onPress={() => open(item.card!.slug)} />
                  : <PlaceCard place={item.place!} width={cardWidth} selected={item.key === selected} onPress={() => setPlaceOpen(item.place!)} />}
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
          {places.length ? (
            <View style={styles.googleSection}>
              <Text style={styles.sectionTitle}>Also nearby</Text>
              <Text style={styles.googleNote}>Not on Chakusa yet · {OSM_CREDIT}</Text>
              {places.map((place) => <PlaceRow key={place.id} place={place} onPress={() => setPlaceOpen(place)} />)}
            </View>
          ) : null}
          {center ? <View style={styles.listToggle}>{viewToggle}</View> : null}
        </ScrollView>
      )}

      <PlaceSheet place={placeOpen} onClose={() => setPlaceOpen(null)} />

      <KeyboardModal visible={picking} animationType="slide" onRequestClose={() => setPicking(false)}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHead}>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setPicking(false)} hitSlop={8}><Ionicons name="close" size={24} color={premium.ink} /></Pressable>
            <Text style={styles.modalTitle}>Search near…</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Use my location" onPress={() => { setPicking(false); void useMyLocation(); }} hitSlop={8}><Ionicons name="locate" size={22} color={premium.deep} /></Pressable>
          </View>
          <View style={styles.flex}>
            <ScrollView contentContainerStyle={styles.modalBody} keyboardShouldPersistTaps="handled">
              <LocationPicker value={draft} onChange={setDraft} onLookupChange={setDraftPending} mapHeight={320} hint="Tap the map to search around that spot." />
            </ScrollView>
            <View style={styles.modalFoot}>
              <Pressable accessibilityRole="button" accessibilityLabel="Search here" disabled={!draft || draftPending} onPress={() => { if (draft) { setOrigin(draft); setLocationError(null); } setPicking(false); }} style={[styles.primary, (!draft || draftPending) && styles.disabled]}>
                <Text style={styles.primaryText}>Search here</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </KeyboardModal>
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

type StripEntry = { key: string; card?: MarketplaceCardDto; place?: NearbyPlaceDto };
const OSM_CREDIT = '© OpenStreetMap contributors';
const INVITE_URL = 'https://chakusarecovery.com';

function PlaceCard({ place, width, selected, onPress }: { place: NearbyPlaceDto; width: number; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${place.name}, ${place.category}. Not on Chakusa yet`} onPress={onPress} style={[styles.mapCard, { width }, selected && styles.mapCardSelected, premiumShadow]}>
      <View style={styles.placeIcon}><Ionicons name="storefront-outline" size={28} color={premium.inkSoft} /></View>
      <View style={styles.mapCardBody}>
        <Text style={styles.cardName} numberOfLines={1}>{place.name}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>{place.category}{place.address ? ` · ${place.address}` : ''}</Text>
        <Text style={styles.newBadge}>Not on Chakusa yet</Text>
        <View style={styles.cardActions}>
          <View style={styles.mapsPill}><Ionicons name="logo-google" size={11} color={premium.deep} /><Text style={styles.mapsPillText}>Maps</Text></View>
        </View>
      </View>
    </Pressable>
  );
}

function PlaceRow({ place, onPress }: { place: NearbyPlaceDto; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${place.name}. Details`} onPress={onPress} style={styles.googleRow}>
      <View style={styles.flex}>
        <Text style={styles.googleName} numberOfLines={1}>{place.name}</Text>
        <Text style={styles.cardMeta} numberOfLines={1}>{[place.category, place.address].filter(Boolean).join(' · ')}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={premium.inkFaint} />
    </Pressable>
  );
}

/** A place that is not on Chakusa: open it in Google Maps (free link), call, or invite it. */
function PlaceSheet({ place, onClose }: { place: NearbyPlaceDto | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  if (!place) return null;
  const invite = () => void Share.share({ message: `I'd love to book ${place.name} on Chakusa - bookings, reminders and messages in one app. ${INVITE_URL}` });
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetOverlay} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]} onPress={() => undefined}>
          <View style={styles.sheetHandle} />
          <Text style={styles.eyebrow}>{place.category.toUpperCase()}</Text>
          <Text style={styles.sheetTitle}>{place.name}</Text>
          {place.address ? <Text style={styles.sheetMeta}>{place.address}</Text> : null}
          {place.openingHours ? <Text style={styles.sheetMeta}>Hours: {place.openingHours}</Text> : null}
          <View style={styles.notOnChakusa}>
            <Ionicons name="information-circle-outline" size={16} color={premium.deepSoft} />
            <Text style={styles.notOnChakusaText}>Not on Chakusa yet, so booking and messages aren't available here.</Text>
          </View>
          <Pressable accessibilityRole="link" accessibilityLabel="See reviews on Google Maps" onPress={() => void Linking.openURL(place.googleMapsUrl)} style={styles.sheetPrimary}>
            <Ionicons name="logo-google" size={16} color={premium.onDeep} />
            <Text style={styles.sheetPrimaryText}>See reviews on Google Maps</Text>
          </Pressable>
          <View style={styles.sheetRow}>
            {place.phone ? (
              <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(`tel:${place.phone}`)} style={styles.sheetSecondary}>
                <Ionicons name="call-outline" size={16} color={premium.deep} /><Text style={styles.sheetSecondaryText}>Call</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" onPress={invite} style={styles.sheetSecondary}>
              <Ionicons name="paper-plane-outline" size={16} color={premium.deep} /><Text style={styles.sheetSecondaryText}>Invite to Chakusa</Text>
            </Pressable>
          </View>
          <Text style={styles.credit}>{OSM_CREDIT}</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  placeIcon: { width: 104, height: 118, borderRadius: 14, backgroundColor: premium.sageSoft, alignItems: 'center', justifyContent: 'center' },
  mapsPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: premium.line, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  mapsPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: premium.deep },
  mapCredit: { alignSelf: 'flex-start', marginLeft: 16, fontFamily: 'Inter_400Regular', fontSize: 10, color: premium.inkSoft, backgroundColor: 'rgba(255,253,249,0.85)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(14,17,22,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: premium.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingTop: 10, gap: 8 },
  sheetHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: premium.line, marginBottom: 8 },
  sheetTitle: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 24, letterSpacing: -0.6, color: premium.ink },
  sheetMeta: { fontFamily: 'Inter_400Regular', fontSize: 13, color: premium.inkSoft },
  notOnChakusa: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: premium.sageSoft, marginTop: 4 },
  notOnChakusaText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12, color: premium.deepSoft },
  sheetPrimary: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 52, borderRadius: 999, backgroundColor: premium.deep, marginTop: 6 },
  sheetPrimaryText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.onDeep },
  sheetRow: { flexDirection: 'row', gap: 10 },
  sheetSecondary: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: 999, borderWidth: 1, borderColor: premium.line, backgroundColor: premium.sageSoft },
  sheetSecondaryText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: premium.deep },
  credit: { fontFamily: 'Inter_400Regular', fontSize: 10, color: premium.inkFaint, textAlign: 'center', marginTop: 4 },
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
