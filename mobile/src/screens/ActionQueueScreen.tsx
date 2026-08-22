import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView as NativeScrollView, ScrollViewProps, StyleSheet, Text, View } from 'react-native';
import { AttentionCategory, AttentionItemDto } from '../apiTypes';
import { AppHeader, EmptyState, ErrorState, LoadingState, PrimaryButton, Screen } from '../components/ui';
import { attentionActionsFor, AttentionActionKind } from '../domain/attentionActions';
import { ApiError } from '../services/api';
import { dashboardApi, leadsApi, remindersApi, reviewsApi } from '../services/endpoints';
import { openCall, openWhatsApp } from '../services/messaging';
import { useAppState } from '../state/AppContext';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDateTime } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'AttentionCenter'>;
const categories: { value: AttentionCategory; label: string }[] = [{ value: 'missed_call_followup', label: 'Missed calls' }, { value: 'customer_due', label: 'Due back' }, { value: 'review_opportunity', label: 'Reviews' }, { value: 'payment_outstanding', label: 'Payments' }];
const categoryKind: Record<AttentionCategory, string> = { missed_call_followup: 'Missed-call follow-up', customer_due: 'Customer due back', review_opportunity: 'Review opportunity', payment_outstanding: 'Payment outstanding' };
function ScrollView({ refreshing, onRefresh, ...props }: ScrollViewProps & { refreshing: boolean; onRefresh: () => void }) { return <NativeScrollView {...props} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />} />; }

export function ActionQueueScreen({ navigation, route }: Props) {
  const { loadDashboard, loadLeads, loadReviews, loadReminders } = useAppState();
  const [category, setCategory] = useState<AttentionCategory>(route.params?.category ?? 'missed_call_followup'); const [items, setItems] = useState<AttentionItemDto[]>([]); const [page, setPage] = useState(1); const [total, setTotal] = useState(0); const [loading, setLoading] = useState(true); const [refreshing, setRefreshing] = useState(false); const [error, setError] = useState<string | null>(null); const [working, setWorking] = useState<string | null>(null);
  const load = useCallback(async (nextPage = 1, append = false) => { setLoading(true); setError(null); try { const result = await dashboardApi.attention(category, nextPage, 25); setItems(current => append ? [...current, ...result.items] : result.items); setTotal(result.total); setPage(result.page); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to load your action queue.'); } finally { setLoading(false); setRefreshing(false); } }, [category]);
  useEffect(() => { void load(); }, [load]); const refresh = () => { setRefreshing(true); void load(); };

  const open = (item: AttentionItemDto) => item.category === 'missed_call_followup' ? navigation.navigate('LeadDetail', { leadId: item.id }) : item.category === 'customer_due' ? navigation.navigate('Comeback') : item.category === 'payment_outstanding' ? navigation.navigate('LeadDetail', { leadId: item.id }) : navigation.navigate('ReviewDetail', { reviewId: item.id });

  // Completing a quick action changes real underlying state (lead status,
  // reminder status, review status, payment status) — the item then stops
  // matching this category's query on the next load, so it naturally
  // disappears rather than needing any local "dismissed" tracking. Also
  // refreshes the Dashboard/lists so recommendations and counts elsewhere
  // stay in sync with the same repository state.
  const removeAndSync = async (id: string) => {
    setItems(current => current.filter(item => item.id !== id));
    setTotal(current => Math.max(0, current - 1));
    await Promise.all([loadDashboard(), loadLeads(), loadReviews(), loadReminders()]);
  };

  const runAction = async (item: AttentionItemDto, kind: AttentionActionKind) => {
    if (kind === 'view') return open(item);
    if (kind === 'call') { void openCall(item.customerPhone!); return; }
    if (kind === 'whatsapp') { void openWhatsApp(item.customerPhone!, item.message!); return; }

    const key = `${item.category}-${item.id}-${kind}`;
    if (working) return;
    setWorking(key);
    try {
      if (kind === 'markDone') await remindersApi.markCompleted(item.id);
      else if (kind === 'markSent') await reviewsApi.markSent(item.id);
      else if (kind === 'markPaid') await leadsApi.updatePayment(item.id, { paymentStatus: 'paid', paidAmount: item.amount ?? 0 });
      await removeAndSync(item.id);
    } catch (caught) {
      Alert.alert('Unable to complete this action', caught instanceof ApiError ? caught.message : 'Please try again.');
    } finally {
      setWorking(null);
    }
  };

  return <Screen scroll={false} style={styles.screen}><AppHeader eyebrow="WHAT NEEDS ACTION" title="Attention Center" subtitle={`${total} action${total === 1 ? '' : 's'} in this category`} /><View style={styles.tabs}>{categories.map(item => <Pressable accessibilityRole="button" key={item.value} onPress={() => setCategory(item.value)} style={[styles.tab, category === item.value && styles.active]}><Text style={[styles.tabText, category === item.value && styles.activeText]}>{item.label}</Text></Pressable>)}</View><ScrollView contentContainerStyle={styles.list} refreshing={refreshing} onRefresh={refresh}>{loading && !items.length ? <LoadingState label="Loading your action queue…" /> : error && !items.length ? <ErrorState message={error} onRetry={() => void load()} /> : !items.length ? <EmptyState title="You're caught up" message="No actions in this category right now." /> : <>{items.map(item => {
    const actions = attentionActionsFor(item);
    return <View key={`${item.category}-${item.id}`} style={styles.item}>
      <Pressable accessibilityRole="button" onPress={() => open(item)} style={styles.itemHeader}>
        <View style={styles.copy}><Text style={styles.kind}>{categoryKind[item.category]}</Text><Text style={styles.customer}>{item.customerName ?? 'Unassigned customer'}</Text><Text style={styles.meta}>{item.detail ?? 'Service not specified'} · {formatDateTime(item.occurredAt)}</Text></View>
        <Ionicons color={colors.tabInactive} name="chevron-forward" size={18} />
      </Pressable>
      <View style={styles.actionsRow}>{actions.map(action => {
        const key = `${item.category}-${item.id}-${action.kind}`;
        const isWorking = working === key;
        return <Pressable accessibilityRole="button" disabled={Boolean(working)} key={action.kind} onPress={() => void runAction(item, action.kind)} style={[styles.actionChip, action.kind === 'view' && styles.actionChipQuiet]}>
          {actionIcon(action.kind) ? <Ionicons color={action.kind === 'view' ? colors.textSecondary : colors.primary} name={actionIcon(action.kind)!} size={14} /> : null}
          <Text style={[styles.actionChipText, action.kind === 'view' && styles.actionChipTextQuiet]}>{isWorking ? 'Working…' : action.label}</Text>
        </Pressable>;
      })}</View>
    </View>;
  })}{items.length < total ? <PrimaryButton disabled={loading} fullWidth label={loading ? 'Loading…' : 'Load more'} onPress={() => void load(page + 1, true)} /> : null}</>}</ScrollView></Screen>;
}

function actionIcon(kind: AttentionActionKind): keyof typeof Ionicons.glyphMap | null {
  return ({ call: 'call', whatsapp: 'logo-whatsapp', markDone: 'checkmark-circle-outline', markSent: 'checkmark-circle-outline', markPaid: 'cash-outline', view: null } as const)[kind];
}

const styles = StyleSheet.create({ screen: { paddingBottom: spacing.lg }, tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, tab: { flex: 1, minWidth: 80, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.round, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, active: { backgroundColor: colors.text }, tabText: { ...typography.caption, color: colors.textSecondary }, activeText: { color: colors.surface }, list: { gap: spacing.sm, paddingBottom: spacing.lg }, item: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm, padding: spacing.md }, itemHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, copy: { flex: 1 }, kind: { ...typography.caption, color: colors.textSecondary }, customer: { ...typography.bodyStrong, color: colors.text }, meta: { ...typography.caption, color: colors.textSecondary }, actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, actionChip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 34, paddingHorizontal: spacing.sm, borderRadius: radius.round, borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primarySoft }, actionChipQuiet: { borderColor: colors.border, backgroundColor: colors.background }, actionChipText: { ...typography.caption, color: colors.primary, fontWeight: '700' }, actionChipTextQuiet: { color: colors.textSecondary } });
