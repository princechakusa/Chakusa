import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ReviewStatus } from '../apiTypes';
import { AppHeader, EmptyState, ErrorState, FilterTabs, IconButton, LoadingState, MetricCard, PrimaryButton, ReviewCard, Screen, SecondaryButton, UsageCard } from '../components/ui';
import { ApiError } from '../services/api';
import { reviewsApi } from '../services/endpoints';
import { useAppState } from '../state/AppContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { colors, radius, spacing, typography } from '../theme';
import { MainTabParamList, RootStackParamList } from '../types';

const filters = ['all', 'pending', 'sent', 'opened', 'reviewed', 'feedback_received'] as const;
export function ReviewsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>(); const route = useRoute<RouteProp<MainTabParamList, 'Reviews'>>(); const { reviews, feedback, customers, state, loadReviews, loadFeedback, loadCustomers } = useAppState(); const { usage, features, refresh: refreshPlan } = usePlanExperience(); const [filter, setFilter] = useState<(typeof filters)[number]>('all'); const [creating, setCreating] = useState(false); const [customerId, setCustomerId] = useState(''); const [serviceName, setServiceName] = useState(''); const [saving, setSaving] = useState(false); const [formError, setFormError] = useState<string | null>(null); const [bulkWorking, setBulkWorking] = useState(false);
  useEffect(() => { void Promise.all([loadReviews(), loadFeedback()]); if (!state.customers.loaded) void loadCustomers(); }, [loadCustomers, loadFeedback, loadReviews, state.customers.loaded]);
  useEffect(() => { const presetId = route.params?.presetCustomerId; if (presetId) { setCustomerId(presetId); setCreating(true); } }, [route.params?.presetCustomerId]);
  const visible = useMemo(() => reviews.filter(review => filter === 'all' || review.status === filter as ReviewStatus), [filter, reviews]); const sentCount = reviews.filter(item => item.status !== 'pending').length; const reviewedCount = reviews.filter(item => item.status === 'reviewed').length;
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
        Alert.alert('Review requests ready', `${result.created.length} request${result.created.length === 1 ? '' : 's'} created and prepared. Open each to copy or send.${result.skipped.length ? ` ${result.skipped.length} skipped.` : ''}`);
      }
    } catch (caught) {
      Alert.alert('Couldn’t run this campaign', caught instanceof ApiError ? caught.message : 'Please try again.');
    } finally {
      setBulkWorking(false);
    }
  };
  const create = async () => { if (saving) return; setSaving(true); setFormError(null); try { const review = await reviewsApi.create({ customerId: customerId || undefined, serviceName: serviceName.trim() || undefined }); void refreshPlan(); setCreating(false); setServiceName(''); await loadReviews(); navigation.navigate('ReviewDetail', { reviewId: review.id }); } catch (error) { setFormError(error instanceof ApiError ? error.message : 'Unable to create review request.'); } finally { setSaving(false); } };
  return <><Screen><AppHeader title="Reviews" subtitle="Honest feedback from every customer" right={<IconButton icon="add" label="Create review request" onPress={() => setCreating(true)} />} />{usage ? <UsageCard label="Review requests this month" current={usage.reviewRequests.current} limit={usage.reviewRequests.limit} periodResetsAt={usage.reviewRequests.resetsAt ?? undefined} onViewPro={() => navigation.navigate('Pro')} /> : null}<View style={styles.metrics}><MetricCard label="Requests sent" value={String(sentCount)} /><MetricCard label="Reviews received" value={String(reviewedCount)} /><MetricCard label="Private feedback" value={String(feedback.length)} /></View><SecondaryButton fullWidth disabled={bulkWorking} icon="megaphone-outline" label={bulkWorking ? 'Working…' : features?.outboundMessaging ? 'Send review campaign' : 'Prepare review requests'} onPress={() => void bulkAction()} /><FilterTabs options={filters} value={filter} onChange={setFilter} />{!state.reviews.loaded && state.reviews.loading ? <LoadingState label="Loading review requests…" /> : state.reviews.error ? <ErrorState message={state.reviews.error} onRetry={() => void loadReviews()} /> : visible.length ? <View style={styles.list}>{visible.map(review => <ReviewCard key={review.id} review={review} onPress={() => navigation.navigate('ReviewDetail', { reviewId: review.id })} />)}</View> : <EmptyState title="No review requests" message="Create a request after completing a customer service." icon="star-outline" />}</Screen>
    <Modal visible={creating} transparent animationType="slide" onRequestClose={() => setCreating(false)}><Pressable style={styles.overlay} onPress={() => !saving && setCreating(false)}><Pressable style={styles.sheet} onPress={() => undefined}><Text style={styles.sheetTitle}>New review request</Text><Text style={styles.label}>Customer</Text><View style={styles.choices}>{customers.map(customer => <Pressable key={customer.id} onPress={() => setCustomerId(customer.id)} style={[styles.choice, customerId === customer.id && styles.choiceActive]}><Text style={[styles.choiceText, customerId === customer.id && styles.choiceTextActive]}>{customer.name}</Text></Pressable>)}</View><Text style={styles.label}>Service</Text><TextInput value={serviceName} onChangeText={setServiceName} style={styles.input} />{formError ? <Text style={styles.error}>{formError}</Text> : null}<PrimaryButton disabled={saving} fullWidth label={saving ? 'Creating…' : 'Create request'} onPress={() => void create()} /><SecondaryButton disabled={saving} fullWidth label="Cancel" onPress={() => setCreating(false)} /></Pressable></Pressable></Modal>
  </>;
}
const styles = StyleSheet.create({ metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }, list: { gap: spacing.sm }, overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }, sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 40, gap: spacing.md }, sheetTitle: { ...typography.heading, color: colors.text }, label: { ...typography.caption, color: colors.text }, input: { minHeight: 48, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, ...typography.body, color: colors.text }, choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, choice: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.round, borderWidth: 1, borderColor: colors.border }, choiceActive: { borderColor: colors.primary }, choiceText: { ...typography.caption, color: colors.textSecondary }, choiceTextActive: { color: colors.primary, fontWeight: '700' }, error: { ...typography.caption, color: colors.negative } });
