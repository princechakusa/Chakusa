import { Ionicons } from '@expo/vector-icons';
import { LeafletMap } from '../../components/map/LeafletMap';
import { directionsUrl } from '../../domain/places';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, Share, StyleSheet, Text, View, Linking } from 'react-native';

import { ErrorState, LoadingState, Screen } from '../../components/ui';
import type { MarketplaceBusinessProfileDto } from '../../apiTypes';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
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
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function SectionLabel({ title }: { title: string }) {
  return <Text style={styles.sectionLabel}>{title}</Text>;
}

function PrimaryBtn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryBtn, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryBtn({ label, icon, compact, onPress }: { label: string; icon?: keyof typeof Ionicons.glyphMap; compact?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.secondaryBtn, compact && styles.secondaryBtnCompact, pressed && styles.pressed]}>
      {icon ? <Ionicons name={icon} size={16} color={authColors.ink} /> : null}
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

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

  if (!loaded) return <Screen backgroundColor={authColors.bg}><LoadingState label="Loading…" /></Screen>;
  if (error || !profile) return <Screen backgroundColor={authColors.bg}><ErrorState message={error ?? 'Not found.'} onRetry={load} /></Screen>;

  const bookable = profile.services.filter((s) => s.bookable);
  const location = [...new Set([profile.address.line, profile.address.city, profile.address.region].filter(Boolean))].join(', ');

  return (
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.heroWrap}>
        <BusinessCover testID="business-photo" uri={profile.photoUrl} name={profile.name} />
      </View>

      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>{profile.category.toUpperCase()}</Text>
          <Text style={styles.title}>{profile.name}</Text>
          {profile.tagline ? <Text style={styles.subtitle}>{profile.tagline}</Text> : null}
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Share this business" hitSlop={8} onPress={() => void share()} style={styles.iconBtn}>
            <Ionicons name="share-outline" size={19} color={authColors.ink} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={favourite ? 'Remove favourite' : 'Add favourite'} hitSlop={8} onPress={() => void toggleFavourite()} style={styles.iconBtn}>
            <Ionicons name={favourite ? 'heart' : 'heart-outline'} size={20} color={favourite ? authColors.coral : authColors.ink} />
          </Pressable>
        </View>
      </View>

      {profile.verified ? <View style={styles.verified}><Ionicons name="shield-checkmark" size={15} color={authColors.positive} /><Text style={styles.verifiedText}>Verified business</Text></View> : null}
      {profile.reviewsSummary.averageRating != null ? (
        <Text style={styles.rating}>★ {profile.reviewsSummary.averageRating.toFixed(1)} · {profile.reviewsSummary.totalReviews} review{profile.reviewsSummary.totalReviews === 1 ? '' : 's'}</Text>
      ) : null}
      {location ? <Text style={styles.meta}>{location}</Text> : null}
      {profile.address.latitude != null && profile.address.longitude != null ? (
        <View testID="business-map" style={styles.mapBlock}>
          <LeafletMap height={170} center={{ latitude: profile.address.latitude, longitude: profile.address.longitude }} zoom={15} markers={[{ latitude: profile.address.latitude, longitude: profile.address.longitude, kind: 'business', label: profile.name }]} accessibilityLabel={'Where ' + profile.name + ' is'} />
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(directionsUrl(profile.address.latitude!, profile.address.longitude!))} style={styles.directions}>
            <Ionicons name="navigate-outline" size={16} color={authColors.coral} />
            <Text style={styles.directionsText}>Get directions</Text>
          </Pressable>
        </View>
      ) : null}
      {profile.contact.phone ? <Text style={styles.meta}>{profile.contact.phone}</Text> : null}
      {profile.about ? <Text style={styles.about}>{profile.about}</Text> : null}

      <View style={styles.actions}>
        <PrimaryBtn
          label={bookable.length ? 'Book an appointment' : 'No online booking'}
          disabled={!bookable.length}
          onPress={() => navigation.navigate('BookingFlow', { slug })}
        />
        <SecondaryBtn label={following ? 'Following' : 'Follow'} icon={following ? 'checkmark' : 'add'} onPress={() => void toggleFollow()} />
      </View>

      {(() => {
        const loyalty = profileLoyaltyState(profile);
        if (!loyalty.show) return null;
        return (
          <View style={styles.loyaltyCard}>
            <View style={styles.loyaltyHeader}>
              <Ionicons name="gift-outline" size={18} color={authColors.coral} />
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
                <SecondaryBtn
                  compact
                  label={loyalty.primaryAction === 'join' ? 'Join rewards' : 'View rewards'}
                  onPress={() => navigation.navigate('CustomerLoyaltyBusiness', { businessId: profile.businessId, slug, businessName: profile.name })}
                />
              ) : null}
              {loyalty.hasMemberships ? (
                <SecondaryBtn compact label="Membership" onPress={() => navigation.navigate('CustomerMembershipPlans', { slug, businessName: profile.name })} />
              ) : null}
            </View>
          </View>
        );
      })()}

      {profile.services.length ? (
        <>
          <SectionLabel title="Services" />
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
                {service.bookable ? <Ionicons name="chevron-forward" size={16} color={authColors.inkFaint} /> : <Text style={styles.cardMeta}>In person</Text>}
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      {profile.reviewsSummary.recent.length ? (
        <>
          <SectionLabel title="Recent reviews" />
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
        <Ionicons name="flag-outline" size={14} color={authColors.inkSoft} />
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
            <SecondaryBtn label="Cancel" onPress={() => setReporting(false)} />
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heroWrap: { marginHorizontal: -authSpace.md, marginTop: -authSpace.sm, aspectRatio: 16 / 9, backgroundColor: authColors.line },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: authSpace.sm, marginTop: authSpace.sm },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: authSpace.xs },
  iconBtn: { width: 36, height: 36, borderRadius: authRadius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.line },
  reportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xxs, paddingVertical: authSpace.md },
  reportText: { ...authType.body, fontSize: 12 },
  reportOverlay: { flex: 1, backgroundColor: 'rgba(14,17,22,0.45)', justifyContent: 'flex-end' },
  reportSheet: { backgroundColor: authColors.surface, borderTopLeftRadius: authRadius.xl, borderTopRightRadius: authRadius.xl, padding: authSpace.lg, gap: authSpace.sm },
  reportTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: authColors.ink, marginBottom: authSpace.xs },
  reportOption: { paddingVertical: authSpace.sm, borderBottomWidth: 1, borderBottomColor: authColors.lineSoft },
  reportOptionText: { ...authType.body, fontSize: 14, color: authColors.ink },
  mapBlock: { gap: authSpace.xs },
  directions: { flexDirection: 'row', alignItems: 'center', gap: authSpace.xxs, alignSelf: 'flex-start', paddingVertical: authSpace.xxs },
  directionsText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: authColors.coral },
  verified: { flexDirection: 'row', alignItems: 'center', gap: authSpace.xxs },
  verifiedText: { ...authType.body, fontSize: 12, color: authColors.positive },
  rating: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  meta: { ...authType.body, fontSize: 13 },
  about: { ...authType.body },
  actions: { gap: authSpace.sm },
  list: { gap: authSpace.xs },
  sectionLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: authColors.ink, marginTop: authSpace.md },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, padding: authSpace.md, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, ...authShadow.card },
  pressed: { opacity: 0.78 },
  cardCopy: { flex: 1, minWidth: 0 },
  cardName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  cardMeta: { ...authType.body, fontSize: 12, marginTop: 2 },
  reviewCard: { padding: authSpace.md, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, gap: authSpace.xxs },
  loyaltyCard: { padding: authSpace.md, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.coral, backgroundColor: authColors.coralSoft, gap: authSpace.xs },
  loyaltyHeader: { flexDirection: 'row', alignItems: 'center', gap: authSpace.xs },
  loyaltyTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  loyaltyMeta: { ...authType.body, fontSize: 12 },
  loyaltyActions: { flexDirection: 'row', flexWrap: 'wrap', gap: authSpace.xs },
  primaryBtn: { minHeight: 52, borderRadius: authRadius.pill, backgroundColor: authColors.coral, alignItems: 'center', justifyContent: 'center', ...authShadow.cta },
  primaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.onCoral },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xxs, minHeight: 48, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface },
  secondaryBtnCompact: { minHeight: 40, paddingHorizontal: authSpace.md, flex: 0, alignSelf: 'flex-start' },
  secondaryBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: authColors.ink },
  disabled: { opacity: 0.5 },
});
