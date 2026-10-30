import { Ionicons } from '../../components/icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Linking, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LeafletMap } from '../../components/map/LeafletMap';
import { photoSource } from '../../components/ProfilePhoto';
import type { MarketplaceBusinessProfileDto, MarketplaceReportReason } from '../../apiTypes';
import { directionsUrl } from '../../domain/places';
import { formatPoints } from '../../domain/loyalty';
import { ApiError } from '../../services/api';
import { formatMoney } from '../../utils/format';
import { PhotoCarousel } from '../components/PhotoCarousel';
import { profileLoyaltyState } from '../domain/customerLoyalty';
import { marketplaceApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';
import { premium, premiumSerif, premiumShadow, ratingText, reviewCountText } from '../premiumTheme';
import { useGuestBrowsing } from '../guestBrowsing';
import { openWhatsApp } from '../../services/messaging';
import { publicProfileWhatsAppGreeting } from '../../domain/publicBusinessProfile';

// Labels map onto the server's report reasons (POST /customer/marketplace/businesses/:slug/report).
const BUSINESS_REPORT_REASONS: ReadonlyArray<{ label: string; reason: MarketplaceReportReason }> = [
  { label: 'Spam or scam', reason: 'scam' },
  { label: 'Inappropriate content', reason: 'inappropriate' },
  { label: 'Wrong information', reason: 'wrong_info' },
  { label: 'Permanently closed', reason: 'closed' },
  { label: 'Other', reason: 'other' },
];
const REVIEW_REPORT_REASONS: ReadonlyArray<{ label: string; reason: MarketplaceReportReason }> = [
  { label: 'Offensive or abusive', reason: 'inappropriate' },
  { label: 'Spam or fake', reason: 'spam' },
  { label: 'Other', reason: 'other' },
];
type ReportTarget = { kind: 'business' } | { kind: 'review'; index: number };

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'BusinessProfile'>;

// A business's page: full-bleed photo gallery, ratings (Chakusa reviews plus
// the live Google rating when the owner linked their listing), services to
// book, a way to ask the business a question, location and reviews.
// When Google content is shown the OpenStreetMap preview is left out
// (Google Maps Platform terms) and directions open in the maps app instead.

function Stars({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <View style={styles.stars} accessibilityLabel={`${value.toFixed(1)} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={value >= i - 0.25 ? 'star' : value >= i - 0.75 ? 'star-half' : 'star-outline'} size={size} color={premium.gold} />
      ))}
    </View>
  );
}

export function BusinessProfileScreen({ route, navigation }: Props) {
  const { slug } = route.params;
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState<MarketplaceBusinessProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [favourite, setFavourite] = useState(false);
  const [following, setFollowing] = useState(false);
  const [pending, setPending] = useState(false);
  const [reporting, setReporting] = useState<ReportTarget | null>(null);
  const [reportSent, setReportSent] = useState(false);
  const [reportedReviews, setReportedReviews] = useState<number[]>([]);
  const [reportError, setReportError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<number | null>(null);
  const { guest, endGuest } = useGuestBrowsing();
  // Guests can look around; anything that needs an account asks them to sign in.
  const requireAccount = (reason: string) => {
    if (!guest) return false;
    Alert.alert('Sign in to continue', `Sign in or create a free account to ${reason}.`, [{ text: 'Not now', style: 'cancel' }, { text: 'Sign in', onPress: endGuest }]);
    return true;
  };

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
    if (pending || requireAccount('save favourites')) return;
    setPending(true);
    const next = !favourite;
    setFavourite(next);
    try { await marketplaceApi.setFavourite(slug, next); } catch { setFavourite(!next); } finally { setPending(false); }
  };
  const toggleFollow = async () => {
    if (pending || requireAccount('follow businesses')) return;
    setPending(true);
    const next = !following;
    setFollowing(next);
    try { await marketplaceApi.setFollow(slug, next); } catch { setFollowing(!next); } finally { setPending(false); }
  };
  const share = async () => {
    if (requireAccount('share businesses')) return;
    try { const info = await marketplaceApi.share(slug); await Share.share({ message: info.message, url: info.shareUrl }); } catch { /* best-effort */ }
  };
  const submitReport = async (target: ReportTarget, reason: MarketplaceReportReason) => {
    setReporting(null); setReportError(null);
    const review = target.kind === 'review' ? profile?.reviewsSummary.recent[target.index] : null;
    const detail = review ? `Reported review (${review.rating}/5, ${review.createdAt}): ${review.comment ?? '(no comment)'}`.slice(0, 2000) : undefined;
    try {
      await marketplaceApi.report(slug, reason, detail);
      if (target.kind === 'review') setReportedReviews((current) => [...current, target.index]);
      else setReportSent(true);
    } catch { setReportError('Couldn’t send your report. Check your connection and try again.'); }
  };

  const topBar = (
    <View style={[styles.topBar, { top: insets.top + 6 }]} pointerEvents="box-none">
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={[styles.roundBtn, premiumShadow]}>
        <Ionicons name="chevron-back" size={22} color={premium.ink} />
      </Pressable>
      {profile ? (
        <View style={styles.topRight}>
          <Pressable accessibilityRole="button" accessibilityLabel="Share this business" onPress={() => void share()} style={[styles.roundBtn, premiumShadow]}>
            <Ionicons name="share-outline" size={19} color={premium.ink} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={favourite ? 'Remove favourite' : 'Add favourite'} onPress={() => void toggleFavourite()} style={[styles.roundBtn, premiumShadow]}>
            <Ionicons name={favourite ? 'heart' : 'heart-outline'} size={20} color={favourite ? premium.danger : premium.ink} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  if (!loaded) return <View style={styles.centre}>{topBar}<ActivityIndicator color={premium.deep} /></View>;
  if (error || !profile) {
    return (
      <View style={styles.centre}>
        {topBar}
        <Text style={styles.errorText}>{error ?? 'Not found.'}</Text>
        <Pressable accessibilityRole="button" onPress={() => { setLoaded(false); void load(); }} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable>
      </View>
    );
  }

  const bookable = profile.services.filter((s) => s.bookable);
  const location = [...new Set([profile.address.line, profile.address.city, profile.address.region].filter(Boolean))].join(', ');
  const gallery = profile.gallery?.length ? profile.gallery : profile.photos.map((url) => ({ url, caption: null }));
  const heroPhotos = gallery.length ? gallery.map((g) => g.url) : [profile.photoUrl].filter((p): p is string => Boolean(p));
  const chakusaRating = profile.reviewsSummary.averageRating;
  const google = profile.google;
  const hasPin = profile.address.latitude != null && profile.address.longitude != null;
  const loyalty = profileLoyaltyState(profile);
  const heroHeight = Math.round(width * 0.82);
  const ask = () => { if (!requireAccount('message this business')) navigation.navigate('CustomerInquiryThread', { slug, businessName: profile.name }); };

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={premium.deep} />}
      >
        <PhotoCarousel testID="business-photo" photos={heroPhotos} name={profile.name} width={width} height={heroHeight} chromeBottom={42} onPress={gallery.length ? (index) => setViewer(index) : undefined} />

        <View style={styles.sheet}>
          <Text style={styles.eyebrow}>{profile.category.toUpperCase()}{profile.address.city ? ` · ${profile.address.city.toUpperCase()}` : ''}</Text>
          <Text style={styles.title}>{profile.name}</Text>
          {profile.tagline ? <Text style={styles.tagline}>{profile.tagline}</Text> : null}

          <View style={styles.ratingStrip}>
            <View style={styles.ratingBlock}>
              {chakusaRating != null ? (
                <>
                  <View style={styles.ratingTop}><Text style={styles.ratingBig}>{ratingText(chakusaRating)}</Text><Stars value={chakusaRating} /></View>
                  <Text style={styles.ratingSource}>{reviewCountText(profile.reviewsSummary.totalReviews)} on Chakusa</Text>
                </>
              ) : (
                <>
                  <Text style={styles.ratingNew}>New</Text>
                  <Text style={styles.ratingSource}>No Chakusa reviews yet</Text>
                </>
              )}
            </View>
            {google?.rating != null ? (
              <Pressable accessibilityRole="link" accessibilityLabel={`Rated ${google.rating.toFixed(1)} on Google from ${google.reviewCount} reviews. Open in Google Maps`} disabled={!google.mapsUrl} onPress={() => google.mapsUrl && void Linking.openURL(google.mapsUrl)} style={[styles.ratingBlock, styles.ratingDivider]}>
                <View style={styles.ratingTop}><Text style={styles.ratingBig}>{google.rating.toFixed(1)}</Text><Stars value={google.rating} /></View>
                <Text style={styles.ratingSource}>{reviewCountText(google.reviewCount)} on <Text style={styles.googleWord}>Google</Text></Text>
              </Pressable>
            ) : null}
            {profile.verified ? (
              <View style={[styles.ratingBlock, styles.ratingDivider, styles.verifiedBlock]}>
                <Ionicons name="shield-checkmark" size={20} color={premium.deepSoft} />
                <Text style={styles.ratingSource}>Verified</Text>
              </View>
            ) : null}
          </View>

          {profile.googleMapsUrl ? (
            <Pressable accessibilityRole="link" accessibilityLabel="See reviews on Google Maps" onPress={() => void Linking.openURL(profile.googleMapsUrl!)} style={({ pressed }) => [styles.googleLink, pressed && styles.pressed]}>
              <Ionicons name="logo-google" size={15} color={premium.deep} />
              <Text style={styles.googleLinkText}>See reviews on Google Maps</Text>
              <Ionicons name="open-outline" size={14} color={premium.inkFaint} />
            </Pressable>
          ) : null}

          <View style={styles.quickRow}>
            <QuickAction icon="chatbubble-ellipses-outline" label="Message" onPress={ask} />
            {hasPin ? <QuickAction icon="navigate-outline" label="Directions" onPress={() => void Linking.openURL(directionsUrl(profile.address.latitude!, profile.address.longitude!))} /> : null}
            {profile.contact.phone ? <QuickAction icon="call-outline" label="Call" onPress={() => void Linking.openURL(`tel:${profile.contact.phone}`)} /> : null}
            {profile.contact.phone ? <QuickAction icon="logo-whatsapp" label="WhatsApp" onPress={() => void openWhatsApp(profile.contact.phone!, publicProfileWhatsAppGreeting(profile.name))} /> : null}
            <QuickAction icon={following ? 'checkmark-circle' : 'add-circle-outline'} label={following ? 'Following' : 'Follow'} onPress={() => void toggleFollow()} />
          </View>

          {profile.about ? (
            <>
              <Text style={styles.section}>About</Text>
              <Text style={styles.body}>{profile.about}</Text>
            </>
          ) : null}

          {profile.services.length ? (
            <>
              <Text style={styles.section}>Services</Text>
              <View style={styles.card}>
                {profile.services.map((service, index) => (
                  <Pressable
                    key={service.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${service.name}. ${service.durationMinutes} minutes.${service.bookable ? ' Book this service.' : ''}`}
                    disabled={!service.bookable}
                    onPress={() => { if (!requireAccount('book an appointment')) navigation.navigate('BookingFlow', { slug, serviceId: service.id }); }}
                    style={({ pressed }) => [styles.serviceRow, index > 0 && styles.rowDivider, pressed && styles.pressed]}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.serviceName}>{service.name}</Text>
                      {service.description ? <Text style={styles.serviceDesc} numberOfLines={2}>{service.description}</Text> : null}
                      <Text style={styles.serviceMeta}>{service.durationMinutes} min</Text>
                    </View>
                    <View style={styles.serviceRight}>
                      {service.price != null ? <Text style={styles.price}>{formatMoney(service.price)}</Text> : null}
                      {service.bookable ? <View style={styles.bookChip}><Text style={styles.bookChipText}>Book</Text></View> : <Text style={styles.serviceMeta}>In person</Text>}
                    </View>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {gallery.length > 1 ? (
            <>
              <Text style={styles.section}>Inside {profile.name}</Text>
              <View style={styles.grid}>
                {gallery.slice(0, 6).map((photo, index) => {
                  const uri = photoSource(photo.url);
                  if (!uri) return null;
                  const tile = (width - 40 - 16) / 3;
                  return (
                    <Pressable key={photo.url} accessibilityRole="imagebutton" accessibilityLabel={photo.caption ?? `Photo ${index + 1}`} onPress={() => setViewer(index)} style={{ width: tile, height: tile }}>
                      <Image source={{ uri }} style={styles.gridImage} />
                      {index === 5 && gallery.length > 6 ? <View style={styles.more}><Text style={styles.moreText}>+{gallery.length - 6}</Text></View> : null}
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {loyalty.show ? (
            <View style={styles.loyalty}>
              <View style={styles.loyaltyHead}>
                <Ionicons name="gift-outline" size={18} color={premium.onDeep} />
                <Text style={styles.loyaltyTitle}>Rewards{loyalty.hasMemberships ? ' & membership' : ''}</Text>
              </View>
              <Text style={styles.loyaltyBody}>
                {loyalty.enrolled
                  ? `You have ${formatPoints(loyalty.pointsBalance)}${loyalty.tierKey ? ` · ${loyalty.tierKey} tier` : ''}${loyalty.isMember ? ' · member' : ''}`
                  : `${loyalty.hasProgram ? 'Earn points when you book here.' : 'Membership plans available.'}${loyalty.rewardCount ? ` ${loyalty.rewardCount} reward${loyalty.rewardCount === 1 ? '' : 's'} to unlock.` : ''}`}
              </Text>
              <View style={styles.loyaltyActions}>
                {loyalty.hasProgram ? <Pressable accessibilityRole="button" onPress={() => { if (!requireAccount('join rewards')) navigation.navigate('CustomerLoyaltyBusiness', { businessId: profile.businessId, slug, businessName: profile.name }); }} style={styles.loyaltyBtn}><Text style={styles.loyaltyBtnText}>{loyalty.primaryAction === 'join' ? 'Join rewards' : 'View rewards'}</Text></Pressable> : null}
                {loyalty.hasMemberships ? <Pressable accessibilityRole="button" onPress={() => { if (!requireAccount('see memberships')) navigation.navigate('CustomerMembershipPlans', { slug, businessName: profile.name }); }} style={styles.loyaltyBtn}><Text style={styles.loyaltyBtnText}>Membership</Text></Pressable> : null}
              </View>
            </View>
          ) : null}

          {location || hasPin ? (
            <>
              <Text style={styles.section}>Location</Text>
              {location ? <Text style={styles.body}>{location}</Text> : null}
              {hasPin && !google ? (
                <View testID="business-map" style={styles.mapWrap}>
                  <LeafletMap height={180} center={{ latitude: profile.address.latitude!, longitude: profile.address.longitude! }} zoom={15} markers={[{ latitude: profile.address.latitude!, longitude: profile.address.longitude!, kind: 'business', label: profile.name }]} accessibilityLabel={`Where ${profile.name} is`} />
                </View>
              ) : null}
              {hasPin ? (
                <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(directionsUrl(profile.address.latitude!, profile.address.longitude!))} style={styles.directions}>
                  <Ionicons name="navigate-outline" size={16} color={premium.deep} />
                  <Text style={styles.directionsText}>Get directions</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}

          {profile.reviewsSummary.recent.length ? (
            <>
              <Text style={styles.section}>What customers say</Text>
              {profile.reviewsSummary.recent.map((review, index) => (
                <View key={index} style={styles.review}>
                  <Stars value={review.rating} size={12} />
                  {review.comment ? <Text style={styles.reviewText}>“{review.comment}”</Text> : null}
                  <View style={styles.reviewFoot}>
                    <Text style={styles.reviewDate}>{new Date(review.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</Text>
                    <Pressable accessibilityRole="button" accessibilityLabel="Report this review" disabled={reportedReviews.includes(index)} hitSlop={8} onPress={() => { if (!requireAccount('report a review')) setReporting({ kind: 'review', index }); }}>
                      <Text style={styles.reviewReport}>{reportedReviews.includes(index) ? 'Reported' : 'Report'}</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </>
          ) : null}

          <Pressable accessibilityRole="button" accessibilityLabel="Report this business" disabled={reportSent} onPress={() => { if (!requireAccount('report this business')) setReporting({ kind: 'business' }); }} style={styles.reportRow}>
            <Ionicons name="flag-outline" size={14} color={premium.inkFaint} />
            <Text style={styles.reportText}>{reportSent ? 'Report sent — thank you' : 'Report this business'}</Text>
          </Pressable>
          {reportError ? <Text accessibilityRole="alert" style={styles.reportError}>{reportError}</Text> : null}
        </View>
      </ScrollView>

      {topBar}

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Ask a question" onPress={ask} style={styles.askBtn}>
          <Ionicons name="chatbubble-ellipses-outline" size={20} color={premium.deep} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={bookable.length ? 'Book an appointment' : 'No online booking'}
          disabled={!bookable.length}
          onPress={() => { if (!requireAccount('book an appointment')) navigation.navigate('BookingFlow', { slug }); }}
          style={({ pressed }) => [styles.bookBtn, !bookable.length && styles.disabled, pressed && styles.pressed]}
        >
          <Text style={styles.bookBtnText}>{bookable.length ? 'Book an appointment' : 'No online booking'}</Text>
          {bookable.length ? <Ionicons name="arrow-forward" size={18} color={premium.onDeep} /> : null}
        </Pressable>
      </View>

      <Modal visible={viewer !== null} transparent animationType="fade" onRequestClose={() => setViewer(null)}>
        <View style={styles.viewer}>
          <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} contentOffset={{ x: (viewer ?? 0) * width, y: 0 }}>
            {gallery.map((photo) => {
              const uri = photoSource(photo.url);
              return uri ? (
                <View key={photo.url} style={{ width, justifyContent: 'center' }}>
                  <Image source={{ uri }} style={{ width, height: width * 1.2 }} resizeMode="contain" />
                  {photo.caption ? <Text style={styles.viewerCaption}>{photo.caption}</Text> : null}
                </View>
              ) : null;
            })}
          </ScrollView>
          <Pressable accessibilityRole="button" accessibilityLabel="Close photos" onPress={() => setViewer(null)} style={[styles.viewerClose, { top: insets.top + 10 }]}>
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </Pressable>
        </View>
      </Modal>

      <Modal visible={reporting !== null} transparent animationType="fade" onRequestClose={() => setReporting(null)}>
        <Pressable style={styles.reportOverlay} onPress={() => setReporting(null)}>
          <View style={[styles.reportSheet, { paddingBottom: 24 + insets.bottom }]}>
            <Text style={styles.reportTitle}>{reporting?.kind === 'review' ? 'Report this review' : `Report ${profile.name}`}</Text>
            {(reporting?.kind === 'review' ? REVIEW_REPORT_REASONS : BUSINESS_REPORT_REASONS).map((option) => (
              <Pressable key={option.label} accessibilityRole="button" onPress={() => reporting && void submitReport(reporting, option.reason)} style={({ pressed }) => [styles.reportOption, pressed && styles.pressed]}>
                <Text style={styles.reportOptionText}>{option.label}</Text>
              </Pressable>
            ))}
            <Pressable accessibilityRole="button" onPress={() => setReporting(null)} style={styles.cancel}><Text style={styles.cancelText}>Cancel</Text></Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function QuickAction({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.quick, pressed && styles.pressed]}>
      <View style={styles.quickIcon}><Ionicons name={icon} size={20} color={premium.deep} /></View>
      <Text style={styles.quickLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: premium.bg },
  centre: { flex: 1, backgroundColor: premium.bg, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  errorText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: premium.inkSoft, textAlign: 'center' },
  retry: { backgroundColor: premium.deep, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 999 },
  retryText: { fontFamily: 'Inter_600SemiBold', color: premium.onDeep },
  flex: { flex: 1 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  topBar: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between' },
  topRight: { flexDirection: 'row', gap: 10 },
  roundBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,253,249,0.96)', alignItems: 'center', justifyContent: 'center' },
  sheet: { marginTop: -28, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: premium.bg, paddingHorizontal: 20, paddingTop: 24, gap: 10 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1.6, color: premium.inkFaint },
  title: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 30, lineHeight: 36, letterSpacing: -1, color: premium.ink },
  tagline: { fontFamily: premiumSerif, fontStyle: 'italic', fontSize: 17, lineHeight: 23, color: premium.inkSoft },
  ratingStrip: { flexDirection: 'row', marginTop: 8, paddingVertical: 14, borderRadius: 20, backgroundColor: premium.card, borderWidth: 1, borderColor: premium.line },
  ratingBlock: { flex: 1, alignItems: 'center', gap: 4, paddingHorizontal: 6 },
  ratingDivider: { borderLeftWidth: 1, borderLeftColor: premium.line },
  verifiedBlock: { justifyContent: 'center' },
  ratingTop: { alignItems: 'center', gap: 2 },
  ratingBig: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 22, color: premium.ink },
  ratingNew: { fontFamily: premiumSerif, fontStyle: 'italic', fontSize: 22, color: premium.deep },
  ratingSource: { fontFamily: 'Inter_400Regular', fontSize: 11, color: premium.inkFaint, textAlign: 'center' },
  googleWord: { fontFamily: 'Inter_600SemiBold', color: premium.google },
  stars: { flexDirection: 'row', gap: 1 },
  googleLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 44, borderRadius: 999, borderWidth: 1, borderColor: premium.line, backgroundColor: premium.card },
  googleLinkText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: premium.deep },
  quickRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 6, paddingVertical: 6 },
  quick: { alignItems: 'center', gap: 6, minWidth: 56 },
  quickIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: premium.sage, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontFamily: 'Inter_500Medium', fontSize: 12, color: premium.ink },
  section: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 19, letterSpacing: -0.4, color: premium.ink, marginTop: 16 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 22, color: premium.inkSoft },
  card: { borderRadius: 20, backgroundColor: premium.card, borderWidth: 1, borderColor: premium.line, overflow: 'hidden' },
  serviceRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  rowDivider: { borderTopWidth: 1, borderTopColor: premium.line },
  serviceName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.ink },
  serviceDesc: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 17, color: premium.inkSoft, marginTop: 2 },
  serviceMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: premium.inkFaint, marginTop: 2 },
  serviceRight: { alignItems: 'flex-end', gap: 6 },
  price: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.ink },
  bookChip: { backgroundColor: premium.deep, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999 },
  bookChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: premium.onDeep },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridImage: { width: '100%', height: '100%', borderRadius: 14, backgroundColor: premium.sage },
  more: { ...StyleSheet.absoluteFill, borderRadius: 14, backgroundColor: 'rgba(24,47,45,0.6)', alignItems: 'center', justifyContent: 'center' },
  moreText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: premium.onDeep },
  loyalty: { marginTop: 16, padding: 18, borderRadius: 22, backgroundColor: premium.deep, gap: 8 },
  loyaltyHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  loyaltyTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: premium.onDeep },
  loyaltyBody: { fontFamily: 'Inter_400Regular', fontSize: 13, color: premium.onDeepSoft },
  loyaltyActions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  loyaltyBtn: { backgroundColor: premium.onDeep, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  loyaltyBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: premium.deep },
  mapWrap: { borderRadius: 18, overflow: 'hidden' },
  directions: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 4 },
  directionsText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: premium.deep },
  review: { padding: 16, borderRadius: 18, backgroundColor: premium.card, borderWidth: 1, borderColor: premium.line, gap: 6 },
  reviewText: { fontFamily: premiumSerif, fontStyle: 'italic', fontSize: 15, lineHeight: 22, color: premium.ink },
  reviewDate: { fontFamily: 'Inter_400Regular', fontSize: 11, color: premium.inkFaint },
  reportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 20 },
  reportError: { fontFamily: 'Inter_400Regular', fontSize: 12, color: premium.danger, textAlign: 'center', marginTop: -12, marginBottom: 12 },
  reviewFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reviewReport: { fontFamily: 'Inter_400Regular', fontSize: 12, color: premium.inkFaint },
  reportText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: premium.inkFaint },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, backgroundColor: premium.card, borderTopWidth: 1, borderTopColor: premium.line },
  askBtn: { width: 54, height: 54, borderRadius: 27, borderWidth: 1, borderColor: premium.line, backgroundColor: premium.sageSoft, alignItems: 'center', justifyContent: 'center' },
  bookBtn: { flex: 1, height: 54, borderRadius: 27, backgroundColor: premium.deep, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  bookBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: premium.onDeep },
  viewer: { flex: 1, backgroundColor: '#070B0A', justifyContent: 'center' },
  viewerCaption: { fontFamily: 'Inter_500Medium', fontSize: 14, color: '#E8EDE6', textAlign: 'center', marginTop: 12, paddingHorizontal: 24 },
  viewerClose: { position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  reportOverlay: { flex: 1, backgroundColor: 'rgba(14,17,22,0.45)', justifyContent: 'flex-end' },
  reportSheet: { backgroundColor: premium.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, gap: 10 },
  reportTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: premium.ink, marginBottom: 6 },
  reportOption: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: premium.line },
  reportOptionText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: premium.ink },
  cancel: { alignItems: 'center', paddingVertical: 12 },
  cancelText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: premium.inkSoft },
});
