import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';

import type { GalleryPhotoDto, GooglePlaceDto } from '../apiTypes';
import { photoSource } from '../components/ProfilePhoto';
import { M3Header, M3Screen } from '../experience/businessKit';
import { m3, m3Space, m3Type } from '../experience/businessTheme';
import { ApiError } from '../services/api';
import { businessApi } from '../services/endpoints';
import { pickGalleryImage, ProfileImageError } from '../services/pickProfileImage';
import { useAuth } from '../state/AuthContext';
import { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'BusinessGallery'>;

const MAX_PHOTOS = 12;

// Owner tools for how the business looks to customers: the photo gallery on
// its Chakusa page and Explore cards, and linking its Google listing so the
// Google rating shows alongside Chakusa reviews.

export function BusinessGalleryScreen({ navigation }: Props) {
  const { width } = useWindowDimensions();
  const { business } = useAuth();
  const [photos, setPhotos] = useState<GalleryPhotoDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placeQuery, setPlaceQuery] = useState(business?.name ?? '');
  const [places, setPlaces] = useState<GooglePlaceDto[] | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(true);
  const [linkedNote, setLinkedNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPhotos(await businessApi.gallery()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load your photos.'); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (busy) return;
    setBusy('add'); setError(null);
    try {
      const data = await pickGalleryImage();
      if (data) { await businessApi.addGalleryPhoto(data); await load(); }
    } catch (caught) {
      setError(caught instanceof ProfileImageError || caught instanceof ApiError ? caught.message : 'Could not add that photo.');
    } finally { setBusy(null); }
  };

  const remove = (photo: GalleryPhotoDto) => {
    Alert.alert('Remove this photo?', 'Customers will no longer see it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        setBusy(photo.id);
        try { await businessApi.deleteGalleryPhoto(photo.id); await load(); }
        catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not remove that photo.'); }
        finally { setBusy(null); }
      } },
    ]);
  };

  const makeCover = async (photo: GalleryPhotoDto) => {
    if (busy) return;
    setBusy(photo.id);
    try { setPhotos(await businessApi.reorderGallery([photo.id, ...photos.filter((p) => p.id !== photo.id).map((p) => p.id)])); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not reorder your photos.'); }
    finally { setBusy(null); }
  };

  const searchGoogle = async () => {
    if (busy || placeQuery.trim().length < 2) return;
    setBusy('google'); setError(null);
    try {
      const result = await businessApi.searchGooglePlace(placeQuery.trim());
      setGoogleEnabled(result.enabled);
      setPlaces(result.places);
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not search Google.'); }
    finally { setBusy(null); }
  };

  const linkPlace = async (place: GooglePlaceDto | null) => {
    setBusy('google');
    try {
      const result = await businessApi.setGooglePlace(place?.placeId ?? null);
      setLinkedNote(place ? `Linked to ${place.name}${result.google?.rating != null ? ` · ${result.google.rating.toFixed(1)} on Google` : ''}` : 'Google listing unlinked');
      setPlaces(null);
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not link that listing.'); }
    finally { setBusy(null); }
  };

  const tile = (width - m3Space.md * 2 - 16) / 3;

  return (
    <M3Screen header={<M3Header businessName="Photos & Google" onBack={() => navigation.goBack()} onNotificationsPress={() => navigation.navigate('AttentionCenter')} hasNotifications={false} />}>
      <View style={styles.card}>
        <Text style={styles.title}>Your photos</Text>
        <Text style={styles.detail}>Show customers your space and your work. The first photo is your cover on Explore. Up to {MAX_PHOTOS} photos.</Text>
        {!loaded ? <ActivityIndicator color={m3.primary} /> : (
          <View style={styles.grid}>
            {photos.map((photo, index) => {
              const uri = photoSource(photo.url);
              return (
                <Pressable key={photo.id} accessibilityRole="button" accessibilityLabel={`Photo ${index + 1}. Options`} onPress={() => Alert.alert(`Photo ${index + 1}`, undefined, [
                  ...(index > 0 ? [{ text: 'Make cover photo', onPress: () => void makeCover(photo) }] : []),
                  { text: 'Remove', style: 'destructive' as const, onPress: () => remove(photo) },
                  { text: 'Cancel', style: 'cancel' as const },
                ])} style={[styles.tile, { width: tile, height: tile }]}>
                  {uri ? <Image source={{ uri }} style={styles.image} /> : null}
                  {index === 0 ? <View style={styles.coverTag}><Text style={styles.coverText}>Cover</Text></View> : null}
                  {busy === photo.id ? <View style={styles.tileBusy}><ActivityIndicator color="#fff" /></View> : null}
                </Pressable>
              );
            })}
            {photos.length < MAX_PHOTOS ? (
              <Pressable accessibilityRole="button" accessibilityLabel="Add a photo" disabled={Boolean(busy)} onPress={() => void add()} style={[styles.tile, styles.addTile, { width: tile, height: tile }]}>
                {busy === 'add' ? <ActivityIndicator color={m3.primary} /> : <Text style={styles.addText}>+ Add</Text>}
              </Pressable>
            ) : null}
          </View>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.title}>Google rating</Text>
        <Text style={styles.detail}>Link your Google Business listing so customers see your Google rating next to your Chakusa reviews.</Text>
        <View style={styles.searchRow}>
          <TextInput value={placeQuery} onChangeText={setPlaceQuery} placeholder="Business name and area" placeholderTextColor={m3.outline} style={styles.input} returnKeyType="search" onSubmitEditing={() => void searchGoogle()} />
          <Pressable accessibilityRole="button" onPress={() => void searchGoogle()} disabled={busy === 'google'} style={styles.btn}>
            {busy === 'google' ? <ActivityIndicator color={m3.onPrimary} /> : <Text style={styles.btnText}>Find</Text>}
          </Pressable>
        </View>
        {!googleEnabled ? <Text style={styles.detail}>Google ratings aren't switched on for Chakusa yet.</Text> : null}
        {places?.length === 0 && googleEnabled ? <Text style={styles.detail}>No matches. Try your name with your street or town.</Text> : null}
        {places?.map((place) => (
          <Pressable key={place.placeId} accessibilityRole="button" onPress={() => void linkPlace(place)} style={styles.place}>
            <Text style={styles.placeName}>{place.name}</Text>
            <Text style={styles.detail}>{[place.address, place.rating != null ? `${place.rating.toFixed(1)}★ (${place.reviewCount})` : null].filter(Boolean).join(' · ')}</Text>
          </Pressable>
        ))}
        {linkedNote ? <Text style={styles.linked}>{linkedNote}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => void linkPlace(null)} hitSlop={6}><Text style={styles.unlink}>Unlink Google listing</Text></Pressable>
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://business.google.com/')} hitSlop={6}><Text style={styles.unlink}>Not on Google yet? Create a listing</Text></Pressable>
      </View>

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </M3Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: m3.surfaceContainerLowest, borderRadius: 20, padding: m3Space.md, gap: 10, marginBottom: m3Space.md },
  title: { ...m3Type.titleMd, color: m3.onSurface },
  detail: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { borderRadius: 14, overflow: 'hidden', backgroundColor: m3.surfaceContainer },
  image: { width: '100%', height: '100%' },
  coverTag: { position: 'absolute', left: 6, bottom: 6, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  coverText: { ...m3Type.labelXs, color: '#fff' },
  tileBusy: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  addTile: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: m3.outline, backgroundColor: 'transparent' },
  addText: { ...m3Type.titleMd, color: m3.primary },
  searchRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: m3.outlineVariant, paddingHorizontal: 12, color: m3.onSurface },
  btn: { minWidth: 72, minHeight: 44, borderRadius: 12, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  btnText: { ...m3Type.titleMd, color: m3.onPrimary },
  place: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: m3.outlineVariant },
  placeName: { ...m3Type.titleMd, color: m3.onSurface },
  linked: { ...m3Type.bodySm, color: m3.secondary },
  unlink: { ...m3Type.bodySm, color: m3.primary },
  error: { ...m3Type.bodySm, color: m3.error, marginBottom: m3Space.md },
});
