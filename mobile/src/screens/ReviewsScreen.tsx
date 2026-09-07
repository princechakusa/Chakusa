import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ReviewRequestDto, ReviewStatus } from '../apiTypes';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { ApiError } from '../services/api';
import { reviewsApi } from '../services/endpoints';
import { useAppState } from '../state/AppContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { colors, radius, spacing, typography } from '../theme';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { MainTabParamList, RootStackParamList } from '../types';

const filters = ['all', 'pending', 'sent', 'opened', 'reviewed', 'feedback_received'] as const;
type Filter = (typeof filters)[number];
const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  pending: 'Pending',
  sent: 'Sent',
  opened: 'Opened',
  reviewed: 'Reviewed',
  feedback_received: 'Private feedback',
};

function relative(iso: string | null) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
function initials(name: string | null | undefined) {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

export function ReviewsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, 'Reviews'>>();
  const { reviews, feedback, customers, state, loadReviews, loadFeedback, loadCustomers } = useAppState();
  const { features, refresh: refreshPlan } = usePlanExperience();
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [bulkWorking, setBulkWorking] = useState(false);

  useEffect(() => {
    void Promise.all([loadReviews(), loadFeedback()]);
    if (!state.customers.loaded) void loadCustomers();
  }, [loadCustomers, loadFeedback, loadReviews, state.customers.loaded]);
  useEffect(() => {
    const presetId = route.params?.presetCustomerId;
    if (presetId) {
      setCustomerId(presetId);
      setCreating(true);
    }
  }, [route.params?.presetCustomerId]);

  const visible = useMemo(
    () => reviews.filter((review) => filter === 'all' || review.status === (filter as ReviewStatus)),
    [filter, reviews],
  );
  const sentCount = reviews.filter((r) => r.status !== 'pending').length;
  const reviewedCount = reviews.filter((r) => r.status === 'reviewed').length;

  const ratings = feedback.map((f) => f.rating).filter((r): r is number => typeof r === 'number' && r > 0);
  const avg = ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
  const dist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: ratings.filter((r) => Math.round(r) === star).length,
  }));
  const needsResponse = feedback.filter((f) => f.status === 'new').length;

  const bulkAction = async () => {
    if (bulkWorking) return;
    setBulkWorking(true);
    try {
      if (features?.outboundMessaging) {
        const result = await reviewsApi.bulkSend();
        await loadReviews();
        Alert.alert('Review campaign sent', `${result.sentCount} sent, ${result.failedCount} failed, ${result.skippedCount} skipped.`);
      } else {
        const result = await reviewsApi.bulkCreate();
        void refreshPlan();
        await loadReviews();
        Alert.alert(
          'Review requests ready',
          `${result.created.length} request${result.created.length === 1 ? '' : 's'} created and prepared.${result.skipped.length ? ` ${result.skipped.length} skipped.` : ''}`,
        );
      }
    } catch (caught) {
      Alert.alert('Could not run this campaign', caught instanceof ApiError ? caught.message : 'Please try again.');
    } finally {
      setBulkWorking(false);
    }
  };
  const create = async () => {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const review = await reviewsApi.create({ customerId: customerId || undefined, serviceName: serviceName.trim() || undefined });
      void refreshPlan();
      setCreating(false);
      setServiceName('');
      await loadReviews();
      navigation.navigate('ReviewDetail', { reviewId: review.id });
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Unable to create review request.');
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <M3Header
      businessName="Reviews & Reputation"
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      onAvatarPress={() => navigation.navigate('Main', { screen: 'Settings' })}
      hasNotifications={needsResponse > 0}
    />
  );

  const renderReview = (review: ReviewRequestDto) => {
    const fb = review.feedback?.[0];
    const rating = fb?.rating ?? null;
    return (
      <M3Card key={review.id} onPress={() => navigation.navigate('ReviewDetail', { reviewId: review.id })} style={styles.reviewCard}>
        <View style={styles.reviewHead}>
          <View style={styles.reviewClientRow}>
            <View style={styles.reviewAvatar}>
              <Text style={styles.reviewAvatarText}>{initials(review.customer?.name)}</Text>
            </View>
            <View style={styles.flex}>
              <Text numberOfLines={1} style={styles.reviewName}>
                {review.customer?.name ?? 'Customer'}
              </Text>
              <View style={styles.reviewStarsRow}>
                {rating != null ? (
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Icon key={s} name={s <= Math.round(rating) ? 'star' : 'star_border'} size={14} color={m3.primary} />
                    ))}
                  </View>
                ) : null}
                <Text style={styles.reviewTime}>{relative(review.sentAt ?? review.createdAt)}</Text>
              </View>
            </View>
          </View>
          <Chip
            label={review.status === 'reviewed' ? 'Reviewed' : review.status === 'pending' ? 'Draft' : 'Sent'}
            tone={review.status === 'reviewed' ? 'secondary' : review.status === 'pending' ? 'primaryFixed' : 'neutral'}
          />
        </View>
        {review.serviceName ? (
          <View style={styles.serviceChip}>
            <Icon name="content_cut" size={13} color={m3.secondary} />
            <Text style={styles.serviceChipText}>{review.serviceName}</Text>
          </View>
        ) : null}
        {fb?.comment ? (
          <Text numberOfLines={3} style={styles.reviewBody}>
            {fb.comment}
          </Text>
        ) : null}
        <View style={styles.reviewActions}>
          <View style={styles.reviewGhostBtn}>
            <Icon name="edit" size={15} color={m3.onSurface} />
            <Text style={styles.reviewGhostText}>Draft reply</Text>
          </View>
          {review.googleReviewLink ? (
            <View style={styles.reviewGhostBtn}>
              <Icon name="open_in_new" size={15} color={m3.onSurface} />
              <Text style={styles.reviewGhostText}>View</Text>
            </View>
          ) : null}
        </View>
      </M3Card>
    );
  };

  const loadingList = !state.reviews.loaded && state.reviews.loading;

  return (
    <>
      <M3Screen header={header}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Reviews & Reputation</Text>
          <Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={styles.requestBtn}>
            <Icon name="send" size={15} color={m3.onPrimary} />
            <Text style={styles.requestText}>Request</Text>
          </Pressable>
        </View>

        <M3Card style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View style={styles.flex}>
              <View style={styles.avgRow}>
                <Text style={styles.avgValue}>{avg != null ? avg.toFixed(2) : '—'}</Text>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <Icon key={s} name={avg != null && s <= Math.round(avg) ? 'star' : 'star_border'} size={16} color={m3.primary} />
                  ))}
                </View>
              </View>
              <Text style={styles.summaryMeta}>
                {ratings.length} rating{ratings.length === 1 ? '' : 's'} · {reviewedCount} public review{reviewedCount === 1 ? '' : 's'}
              </Text>
            </View>
            {needsResponse ? <Chip label={`${needsResponse} needs response`} tone="primaryFixed" /> : null}
          </View>

          <View style={styles.tileRow}>
            <View style={styles.tile}>
              <View style={styles.tileHead}>
                <Icon name="verified" size={15} color={m3.secondary} />
                <Text style={styles.tileLabel}>Requests sent</Text>
              </View>
              <Text style={styles.tileValue}>{sentCount}</Text>
            </View>
            <View style={styles.tile}>
              <View style={styles.tileHead}>
                <Icon name="reviews" size={15} color={m3.secondary} />
                <Text style={styles.tileLabel}>Private feedback</Text>
              </View>
              <Text style={styles.tileValue}>{feedback.length}</Text>
            </View>
          </View>

          {ratings.length ? (
            <View style={styles.distWrap}>
              {dist.map((row) => {
                const pct = ratings.length ? Math.round((row.count / ratings.length) * 100) : 0;
                return (
                  <View key={row.star} style={styles.distRow}>
                    <Text style={styles.distStar}>{row.star}★</Text>
                    <View style={styles.distTrack}>
                      <View style={[styles.distFill, { width: `${pct}%` }]} />
                    </View>
                    <Text style={styles.distCount}>{row.count}</Text>
                  </View>
                );
              })}
            </View>
          ) : null}
        </M3Card>

        <Pressable
          accessibilityRole="button"
          disabled={bulkWorking}
          onPress={() => void bulkAction()}
          style={[styles.campaignBtn, bulkWorking && styles.disabled]}
        >
          <Icon name="campaign" size={17} color={m3.onSecondaryContainer} />
          <Text style={styles.campaignText}>
            {bulkWorking ? 'Working…' : features?.outboundMessaging ? 'Send review campaign' : 'Prepare review requests'}
          </Text>
        </Pressable>

        <View style={styles.chipsWrap}>
          {filters.map((f) => (
            <Chip key={f} label={FILTER_LABEL[f]} selected={filter === f} onPress={() => setFilter(f)} />
          ))}
        </View>

        {loadingList ? (
          <M3Loading label="Loading review requests…" />
        ) : state.reviews.error ? (
          <M3Error message={state.reviews.error} onRetry={() => void loadReviews()} />
        ) : visible.length ? (
          <View style={styles.list}>{visible.map(renderReview)}</View>
        ) : (
          <M3Empty icon="star_border" title="No review requests" message="Create a request after completing a customer service." />
        )}
      </M3Screen>

      <Modal visible={creating} transparent animationType="slide" onRequestClose={() => setCreating(false)}>
        <Pressable style={styles.overlay} onPress={() => !saving && setCreating(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>New review request</Text>
            <Text style={styles.label}>Customer</Text>
            <View style={styles.choices}>
              {customers.map((customer) => (
                <Pressable key={customer.id} onPress={() => setCustomerId(customer.id)} style={[styles.choice, customerId === customer.id && styles.choiceActive]}>
                  <Text style={[styles.choiceText, customerId === customer.id && styles.choiceTextActive]}>{customer.name}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Service</Text>
            <TextInput value={serviceName} onChangeText={setServiceName} style={styles.input} />
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <PrimaryButton disabled={saving} fullWidth label={saving ? 'Creating…' : 'Create request'} onPress={() => void create()} />
            <SecondaryButton disabled={saving} fullWidth label="Cancel" onPress={() => setCreating(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  list: { gap: m3Space.sm },
  disabled: { opacity: 0.5 },
  starsRow: { flexDirection: 'row', alignItems: 'center' },

  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m3Space.sm },
  title: { ...m3Type.headlineMd, color: m3.onSurface, flexShrink: 1 },
  requestBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: m3Radius.sm, backgroundColor: m3.primary },
  requestText: { ...m3Type.labelMd, color: m3.onPrimary },

  summaryCard: { gap: m3Space.md },
  summaryTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm },
  avgRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avgValue: { ...m3Type.displayMobile, fontSize: 30, lineHeight: 34, color: m3.onSurface },
  summaryMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 3 },
  tileRow: { flexDirection: 'row', gap: m3Space.xs },
  tile: { flex: 1, backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.sm, padding: m3Space.sm },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tileLabel: { ...m3Type.labelSm, color: m3.secondary, letterSpacing: 0 },
  tileValue: { ...m3Type.headlineSm, fontSize: 18, color: m3.onSurface, marginTop: 3 },
  distWrap: { gap: 6 },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  distStar: { ...m3Type.labelSm, color: m3.onSurfaceVariant, width: 26, letterSpacing: 0 },
  distTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: m3.surfaceContainerHigh, overflow: 'hidden' },
  distFill: { height: '100%', borderRadius: 4, backgroundColor: m3.secondary },
  distCount: { ...m3Type.labelSm, color: m3.onSurface, width: 30, textAlign: 'right', letterSpacing: 0 },

  campaignBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: m3Radius.md, backgroundColor: m3.secondaryContainer },
  campaignText: { ...m3Type.labelMd, color: m3.onSecondaryContainer },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },

  reviewCard: { gap: 10 },
  reviewHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.xs },
  reviewClientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  reviewAvatar: { width: 40, height: 40, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  reviewAvatarText: { ...m3Type.labelMd, color: m3.primary },
  reviewName: { ...m3Type.labelLg, color: m3.onSurface },
  reviewStarsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  reviewTime: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  serviceChip: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', backgroundColor: m3.surfaceContainerLow, paddingHorizontal: 8, paddingVertical: 4, borderRadius: m3Radius.sm },
  serviceChipText: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  reviewBody: { ...m3Type.bodyMd, color: m3.onSurface },
  reviewActions: { flexDirection: 'row', gap: m3Space.xs },
  reviewGhostBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 12, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainerLow },
  reviewGhostText: { ...m3Type.labelMd, color: m3.onSurface },

  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 40, gap: spacing.md },
  sheetTitle: { ...typography.heading, color: colors.text },
  label: { ...typography.caption, color: colors.text },
  input: { minHeight: 48, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, ...typography.body, color: colors.text },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  choice: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.round, borderWidth: 1, borderColor: colors.border },
  choiceActive: { borderColor: colors.primary },
  choiceText: { ...typography.caption, color: colors.textSecondary },
  choiceTextActive: { color: colors.primary, fontWeight: '700' },
  error: { ...typography.caption, color: colors.negative },
});
