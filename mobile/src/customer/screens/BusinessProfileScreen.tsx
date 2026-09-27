import { Ionicons } from '@expo/vector-icons';
import { LeafletMap } from '../../components/map/LeafletMap';
import { directionsUrl } from '../../domain/places';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, Share, StyleSheet, Text, View, Linking } from 'react-native';

import { AppHeader, ErrorState, LoadingState, PrimaryButton, Screen, SecondaryButton, SectionHeader } from '../../components/ui';
import type { MarketplaceBusinessProfileDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatMoney } from '../../utils/format';
import { formatPoints } from '../../domain/loyalty';
import { BusinessCover } from '../components/cards';
import { profileLoyaltyState } from '../domain/customerLoyalty';
import { marketplaceApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

const REPORT_REASONS = ['Spam or scam', 'Inappropriate content', 'Permanently closed', 'Other'] as const;

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
  const [reporting, setReporting] = useState(false);
  const [reportSent, setReportSent] = useState(false);

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

  const share = async () => {
    try {
      const info = await marketplaceApi.share(slug);
      await Share.share({ message: info.message, url: info.shareUrl });
    } catch { /* sharing is best-effort */ }
  };

  const submitReport = async (reason: string) => {
    setReporting(false);
    try { await marketplaceApi.report(slug, reason); setReportSent(true); } catch { /* best-effort */ }
  };

  if (!loaded) return <Screen><LoadingState label="Loading…" /></Screen>;
  if (error || !profile) return <Screen><ErrorState message={error ?? 'Not found.'} onRetry={load} /></Screen>;

  const bookable = profile.services.filter((s) => s.bookable);
  const location = [...new Set([profile.address.line, profile.address.city, profile.address.region].filter(Boolean))].join(', ');

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.heroWrap}>
        <BusinessCover testID="business-photo" uri={profile.photoUrl} name={profile.name} />
      </View>
      <AppHeader
        eyebrow={profile.category.toUpperCase()}
        title={profile.name}
        subtitle={profile.tagline ?? undefined}
        right={
          <View style={styles.headerActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Share this business" hitSlop={8} onPress={() => void share()}>
              <Ionicons name="share-outline" size={22} color={colors.text} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={favourite ? 'Remove favourite' : 'Add favourite'} hitSlop={8} onPress={() => void toggleFavourite()}>
              <Ionicons name={favourite ? 'heart' : 'heart-outline'} size={24} color={favourite ? colors.primary : colors.text} />
            </Pressable>
          </View>
        }
      />

      {profile.verified ? <View style={styles.verified}><Ionicons name="shield-checkmark" size={15} color={colors.success} /><Text style={styles.verifiedText}>Verified business</Text></View> : null}
      {profile.reviewsSummary.averageRating != null ? (
        <Text style={styles.rating}>★ {profile.reviewsSummary.averageRating.toFixed(1)} · {profile.reviewsSummary.totalReviews} review{profile.reviewsSummary.totalReviews === 1 ? '' : 's'}</Text>
      ) : null}
      {location ? <Text style={styles.meta}>{location}</Text> : null}
      {profile.address.latitude != null && profile.address.longitude != null ? (
        <View testID="business-map" style={styles.mapBlock}>
          <LeafletMap height={170} center={{ latitude: profile.address.latitude, longitude: profile.address.longitude }} zoom={15} markers={[{ latitude: profile.address.latitude, longitude: profile.address.longitude, kind: 'business', label: profile.name }]} accessibilityLabel={'Where ' + profile.name + ' is'} />
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(directionsUrl(profile.address.latitude!, profile.address.longitude!))} style={styles.directions}>
            <Ionicons name="navigate-outline" size={16} color={colors.primary} />
            <Text style={styles.directionsText}>Get directions</Text>
          </Pressable>
        </View>
      ) : null}
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

      {(() => {
        const loyalty = profileLoyaltyState(profile);
        if (!loyalty.show) return null;
        return (
          <View style={styles.loyaltyCard}>
            <View style={styles.loyaltyHeader}>
              <Ionicons name="gift-outline" size={18} color={colors.primary} />
              <Text style={styles.loyaltyTitle}>Rewards{loyalty.hasMemberships ? ' & membership' : ''}</Text>
            </View>
            {loyalty.enrolled ? (
              <Text style={styles.loyaltyMeta}>
                You have {formatPoints(loyalty.pointsBalance)}{loyalty.tierKey ? ` · ${loyalty.tierKey} tier` : ''}{loyalty.isMember ? ' · member' : ''}
              </Text>
            ) : (
              <Text style={styles.loyaltyMeta}>
                {loyalty.hasProgram ? 'Earn points when you book here.' : 'Membership plans available.'}
                {loyalty.rewardCount ? ` ${loyalty.rewardCount} reward${loyalty.rewardCount === 1 ? '' : 's'} to unlock.` : ''}
              </Text>
            )}
            <View style={styles.loyaltyActions}>
              {loyalty.hasProgram ? (
                <SecondaryButton
                  compact
                  label={loyalty.primaryAction === 'join' ? 'Join rewards' : 'View rewards'}
                  onPress={() => navigation.navigate('CustomerLoyaltyBusiness', { businessId: profile.businessId, slug, businessName: profile.name })}
                />
              ) : null}
              {loyalty.hasMemberships ? (
                <SecondaryButton compact label="Membership" onPress={() => navigation.navigate('CustomerMembershipPlans', { slug, businessName: profile.name })} />
              ) : null}
            </View>
          </View>
        );
      })()}

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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Report this business"
        disabled={reportSent}
        onPress={() => setReporting(true)}
        style={styles.reportRow}
      >
        <Ionicons name="flag-outline" size={14} color={colors.textSecondary} />
        <Text style={styles.reportText}>{reportSent ? 'Report sent — thank you' : 'Report this business'}</Text>
      </Pressable>

      <Modal visible={reporting} transparent animationType="fade" onRequestClose={() => setReporting(false)}>
        <Pressable style={styles.reportOverlay} onPress={() => setReporting(false)}>
          <View style={styles.reportSheet}>
            <Text style={styles.reportTitle}>Report {profile.name}</Text>
            {REPORT_REASONS.map((reason) => (
              <Pressable key={reason} accessibilityRole="button" onPress={() => void submitReport(reason)} style={({ pressed }) => [styles.reportOption, pressed && styles.pressed]}>
                <Text style={styles.reportOptionText}>{reason}</Text>
              </Pressable>
            ))}
            <SecondaryButton fullWidth label="Cancel" onPress={() => setReporting(false)} />
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroWrap: { marginHorizontal: -spacing.lg, marginTop: -spacing.sm, aspectRatio: 16 / 9, backgroundColor: colors.border },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  reportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xxs, paddingVertical: spacing.md },
  reportText: { ...typography.caption, color: colors.textSecondary },
  reportOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  reportSheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  reportTitle: { ...typography.subheading, color: colors.text, marginBottom: spacing.xs },
  reportOption: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  reportOptionText: { ...typography.body, color: colors.text },
  mapBlock: { gap: spacing.xs },
  directions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, alignSelf: 'flex-start', paddingVertical: spacing.xxs },
  directionsText: { ...typography.bodyStrong, fontSize: 14, color: colors.primary },
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
  loyaltyCard: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.surface, gap: spacing.xs },
  loyaltyHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  loyaltyTitle: { ...typography.bodyStrong, color: colors.text },
  loyaltyMeta: { ...typography.caption, color: colors.textSecondary },
  loyaltyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
