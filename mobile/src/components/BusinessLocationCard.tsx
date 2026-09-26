import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { BusinessLocationDto } from '../apiTypes';
import type { Place } from '../domain/places';
import { ApiError } from '../services/api';
import { businessApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';
import { LeafletMap } from './map/LeafletMap';
import { LocationPicker } from './map/LocationPicker';

// Business settings: where the business is. Customers searching "near me"
// only find businesses that have pinned a location here.

const toPlace = (location: BusinessLocationDto): Place => ({
  ...location,
  label: [location.addressLine, location.city].filter(Boolean).join(', ') || location.region || `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`,
});

export function BusinessLocationCard() {
  const [saved, setSaved] = useState<BusinessLocationDto | null>(null);
  const [draft, setDraft] = useState<Place | null>(null);
  const [editing, setEditing] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [state, setState] = useState<'loading' | 'idle' | 'saving'>('loading');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    businessApi.get()
      .then((business) => setSaved(business.location ?? null))
      .catch(() => setMessage({ tone: 'error', text: 'Could not load your saved location.' }))
      .finally(() => setState('idle'));
  }, []);

  const save = async (next: BusinessLocationDto | null) => {
    setState('saving'); setMessage(null);
    try {
      await businessApi.setLocation(next);
      setSaved(next);
      setEditing(false);
      setMessage({ tone: 'ok', text: next ? 'Location saved. Customers nearby can now find you.' : 'Location removed.' });
    } catch (caught) {
      setMessage({ tone: 'error', text: caught instanceof ApiError ? caught.message : 'Could not save the location.' });
    } finally {
      setState('idle');
    }
  };

  return (
    <View testID="business-location-card" style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}><Ionicons name="location" size={20} color={colors.primary} /></View>
        <View style={styles.headCopy}>
          <Text style={styles.title}>Business location</Text>
          <Text style={styles.detail}>Lets customers find you with “near me” and get directions.</Text>
        </View>
      </View>

      {state === 'loading' ? <ActivityIndicator color={colors.primary} /> : editing ? (
        <>
          <LocationPicker value={draft} onChange={setDraft} onLookupChange={setLookingUp} hint="Tap the map to put the pin on your front door." />
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={() => { setEditing(false); setDraft(null); }} style={styles.secondary}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save location"
              disabled={!draft || lookingUp || state === 'saving'}
              onPress={() => draft && void save({ latitude: draft.latitude, longitude: draft.longitude, addressLine: draft.addressLine, city: draft.city, region: draft.region })}
              style={[styles.primary, (!draft || lookingUp || state === 'saving') && styles.disabled]}
            >
              <Text style={styles.primaryText}>{state === 'saving' ? 'Saving…' : lookingUp ? 'Finding address…' : 'Save location'}</Text>
            </Pressable>
          </View>
        </>
      ) : saved ? (
        <>
          <LeafletMap height={160} center={saved} zoom={15} markers={[{ ...saved, kind: 'business', label: toPlace(saved).label }]} accessibilityLabel="Your business on the map" />
          <Text testID="business-location-label" style={styles.savedLabel}>{toPlace(saved).label}</Text>
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={() => void save(null)} style={styles.secondary}><Text style={styles.secondaryText}>Remove</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={() => { setDraft(toPlace(saved)); setEditing(true); setMessage(null); }} style={styles.primary}><Text style={styles.primaryText}>Change location</Text></Pressable>
          </View>
        </>
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Set business location" onPress={() => { setEditing(true); setMessage(null); }} style={styles.primary}>
          <Text style={styles.primaryText}>Set business location</Text>
        </Pressable>
      )}
      {message ? <Text accessibilityRole={message.tone === 'error' ? 'alert' : undefined} style={message.tone === 'error' ? styles.error : styles.ok}>{message.text}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  headCopy: { flex: 1, gap: 2 },
  title: { ...typography.bodyStrong, color: colors.text },
  detail: { ...typography.caption, color: colors.textSecondary },
  savedLabel: { ...typography.bodyStrong, color: colors.text },
  actions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  primary: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.round, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { ...typography.bodyStrong, color: colors.surface },
  secondary: { minHeight: 44, paddingHorizontal: spacing.md, borderRadius: radius.round, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { ...typography.bodyStrong, color: colors.text },
  disabled: { opacity: 0.5 },
  ok: { ...typography.caption, color: colors.success },
  error: { ...typography.caption, color: colors.negative },
});
