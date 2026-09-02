import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppHeader, ErrorState, LoadingState, PrimaryButton, Screen, SecondaryButton, SectionHeader } from '../../components/ui';
import type { MarketplaceBusinessProfileDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatMoney } from '../../utils/format';
import { marketplaceApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'BusinessProfile'>;

// PROGRAM 2 LOOP 7: a business's public profile. `/customer/marketplace/
// businesses/:slug` for the content; favourite/follow/report are the only
// writes. "Book" hands off to the booking flow.

export function BusinessProfileScreen({ route, navigation }: Props) {
  const { slug } = route.params;
  const [profile, setProfile] = useState<MarketplaceBusinessProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [favourite, setFavourite] = useState(false);
  const [following, setFollowing] = useState(false);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await marketplaceApi.business(slug);
      setProfile(data);
      setFavourite(data.viewer.favourite);
      setFollowing(data.viewer.following);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load this business.');
    } finally {
      setLoaded(true);
    }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const toggleFavourite = async () => {
    if (pending) return;
    setPending(true);
    const next = !favourite;
    setFavourite(next);
    try { await marketplaceApi.setFavourite(slug, next); }
    catch { setFavourite(!next); }
    finally { setPending(false); }
  };

  const toggleFollow = async () => {
    if (pending) return;
    setPending(true);
    const next = !following;
    setFollowing(next);
    try { await marketplaceApi.setFollow(slug, next); }
    catch { setFollowing(!next); }
    finally { setPending(false); }
  };

  if (!loaded) return <Screen><LoadingState label="Loading…" /></Screen>;
  if (error || !profile) return <Screen><ErrorState message={error ?? 'Not found.'} onRetry={load} /></Screen>;

  const bookable = profile.services.filter((s) => s.bookable);
  const location = [profile.address.line, profile.address.city, profile.address.region].filter(Boolean).join(', ');

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader
        eyebrow={profile.category.toUpperCase()}
        title={profile.name}
        subtitle={profile.tagline ?? undefined}
        right={
          <Pressable accessibilityRole="button" accessibilityLabel={favourite ? 'Remove favourite' : 'Add favourite'} hitSlop={8} onPress={() => void toggleFavourite()}>
            <Ionicons name={favourite ? 'heart' : 'heart-outline'} size={24} color={favourite ? colors.primary : colors.text} />
          </Pressable>
        }
      />

      {profile.verified ? <View style={styles.verified}><Ionicons name="shield-checkmark" size={15} color={colors.success} /><Text style={styles.verifiedText}>Verified business</Text></View> : null}
      {profile.reviewsSummary.averageRating != null ? (
        <Text style={styles.rating}>★ {profile.reviewsSummary.averageRating.toFixed(1)} · {profile.reviewsSummary.totalReviews} review{profile.reviewsSummary.totalReviews === 1 ? '' : 's'}</Text>
      ) : null}
      {location ? <Text style={styles.meta}>{location}</Text> : null}
      {profile.contact.phone ? <Text style={styles.meta}>{profile.contact.phone}</Text> : null}
      {profile.about ? <Text style={styles.about}>{profile.about}</Text> : null}

      <View style={styles.actions}>
        <PrimaryButton
          fullWidth
          label={bookable.length ? 'Book an appointment' : 'No online booking'}
          disabled={!bookable.length}
          onPress={() => navigation.navigate('BookingFlow', { slug })}
        />
        <SecondaryButton fullWidth label={following ? 'Following' : 'Follow'} icon={following ? 'checkmark' : 'add'} onPress={() => void toggleFollow()} />
      </View>

      {profile.services.length ? (
        <>
          <SectionHeader title="Services" />
          <View style={styles.list}>
            {profile.services.map((service) => (
              <Pressable
                key={service.id}
                accessibilityRole="button"
                accessibilityLabel={`${service.name}. ${service.durationMinutes} minutes.${service.bookable ? ' Book this service.' : ''}`}
                disabled={!service.bookable}
                onPress={() => navigation.navigate('BookingFlow', { slug, serviceId: service.id })}
                style={({ pressed }) => [styles.serviceRow, pressed && styles.pressed]}
              >
                <View style={styles.cardCopy}>
                  <Text style={styles.cardName}>{service.name}</Text>
                  <Text style={styles.cardMeta}>
                    {service.durationMinutes} min{service.price != null ? ` · ${formatMoney(service.price)}` : ''}
                  </Text>
                </View>
                {service.bookable ? <Ionicons name="chevron-forward" size={16} color={colors.tabInactive} /> : <Text style={styles.cardMeta}>In person</Text>}
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {profile.reviewsSummary.recent.length ? (
        <>
          <SectionHeader title="Recent reviews" />
          <View style={styles.list}>
            {profile.reviewsSummary.recent.map((review, index) => (
              <View key={index} style={styles.reviewCard}>
                <Text style={styles.cardName}>{'★'.repeat(Math.round(review.rating))}</Text>
                {review.comment ? <Text style={styles.cardMeta}>{review.comment}</Text> : null}
              </View>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  verified: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs },
  verifiedText: { ...typography.caption, color: colors.success },
  rating: { ...typography.bodyStrong, color: colors.text },
  meta: { ...typography.caption, color: colors.textSecondary },
  about: { ...typography.body, color: colors.textSecondary },
  actions: { gap: spacing.sm },
  list: { gap: spacing.xs },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pressed: { opacity: 0.78 },
  cardCopy: { flex: 1, minWidth: 0 },
  cardName: { ...typography.bodyStrong, color: colors.text },
  cardMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  reviewCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xxs },
});
