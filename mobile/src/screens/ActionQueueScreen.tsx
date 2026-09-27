import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { AttentionCategory, AttentionItemDto } from '../apiTypes';
import { attentionActionsFor, AttentionActionKind } from '../domain/attentionActions';
import { ApiError } from '../services/api';
import { dashboardApi, leadsApi, remindersApi, reviewsApi } from '../services/endpoints';
import { openCall, openWhatsApp } from '../services/messaging';
import { useAppState } from '../state/AppContext';
import { RootStackParamList } from '../types';
import { formatDateTime } from '../utils/format';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, IconName, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';

type Props = NativeStackScreenProps<RootStackParamList, 'AttentionCenter'>;

const categories: { value: AttentionCategory; label: string; icon: IconName }[] = [
  { value: 'missed_call_followup', label: 'Missed calls', icon: 'phone_missed' },
  { value: 'customer_due', label: 'Due back', icon: 'event_repeat' },
  { value: 'review_opportunity', label: 'Reviews', icon: 'star' },
  { value: 'payment_outstanding', label: 'Payments', icon: 'local_atm' },
];
const categoryKind: Record<AttentionCategory, string> = {
  missed_call_followup: 'Missed-call follow-up',
  customer_due: 'Customer due back',
  review_opportunity: 'Review opportunity',
  payment_outstanding: 'Payment outstanding',
};
const categoryIcon: Record<AttentionCategory, IconName> = {
  missed_call_followup: 'phone_missed',
  customer_due: 'event_repeat',
  review_opportunity: 'star',
  payment_outstanding: 'local_atm',
};

function actionIcon(kind: AttentionActionKind): IconName | null {
  return ({ call: 'call', whatsapp: 'forum', markDone: 'task_alt', markSent: 'task_alt', markPaid: 'local_atm', view: null } as const)[kind];
}

export function ActionQueueScreen({ navigation, route }: Props) {
  const { loadDashboard, loadLeads, loadReviews, loadReminders } = useAppState();
  const [category, setCategory] = useState<AttentionCategory>(route.params?.category ?? 'missed_call_followup');
  const [items, setItems] = useState<AttentionItemDto[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(
    async (nextPage = 1, append = false) => {
      setLoading(true);
      setError(null);
      try {
        const result = await dashboardApi.attention(category, nextPage, 25);
        setItems((current) => (append ? [...current, ...result.items] : result.items));
        setTotal(result.total);
        setPage(result.page);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Unable to load your action queue.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [category],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const refresh = () => {
    setRefreshing(true);
    void load();
  };

  const open = (item: AttentionItemDto) =>
    item.category === 'missed_call_followup'
      ? navigation.navigate('LeadDetail', { leadId: item.id })
      : item.category === 'customer_due'
        ? navigation.navigate('Comeback')
        : item.category === 'payment_outstanding'
          ? navigation.navigate('LeadDetail', { leadId: item.id })
          : navigation.navigate('ReviewDetail', { reviewId: item.id });

  // Completing a quick action changes real underlying state (lead status,
  // reminder status, review status, payment status) - the item then stops
  // matching this category's query on the next load, so it naturally
  // disappears rather than needing any local "dismissed" tracking. Also
  // refreshes the Dashboard/lists so recommendations and counts elsewhere
  // stay in sync with the same repository state.
  const removeAndSync = async (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    setTotal((current) => Math.max(0, current - 1));
    await Promise.all([loadDashboard(), loadLeads(), loadReviews(), loadReminders()]);
  };

  const runAction = async (item: AttentionItemDto, kind: AttentionActionKind) => {
    if (kind === 'view') return open(item);
    if (kind === 'call') {
      void openCall(item.customerPhone!);
      return;
    }
    if (kind === 'whatsapp') {
      void openWhatsApp(item.customerPhone!, item.message!);
      return;
    }

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

  const header = <M3Header businessName="Dispatch" onBack={() => navigation.goBack()} />;

  const renderItem = (item: AttentionItemDto) => {
    const actions = attentionActionsFor(item);
    return (
      <M3Card key={`${item.category}-${item.id}`} style={styles.card}>
        <Pressable accessibilityRole="button" onPress={() => open(item)} style={styles.itemHeader}>
          <View style={styles.itemIcon}>
            <Icon name={categoryIcon[item.category]} size={17} color={m3.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.kind}>{categoryKind[item.category]}</Text>
            <Text numberOfLines={1} style={styles.customer}>
              {item.customerName ?? 'Unassigned customer'}
            </Text>
            <Text numberOfLines={1} style={styles.meta}>
              {item.detail ?? 'Service not specified'} · {formatDateTime(item.occurredAt)}
            </Text>
          </View>
          <Icon name="chevron_right" size={18} color={m3.outline} />
        </Pressable>
        <View style={styles.actionsRow}>
          {actions.map((action) => {
            const key = `${item.category}-${item.id}-${action.kind}`;
            const isWorking = working === key;
            const icon = actionIcon(action.kind);
            const isView = action.kind === 'view';
            return (
              <Pressable
                key={action.kind}
                accessibilityRole="button"
                disabled={Boolean(working)}
                onPress={() => void runAction(item, action.kind)}
                style={[styles.actionChip, isView ? styles.actionChipQuiet : styles.actionChipPrimary]}
              >
                {icon ? <Icon name={icon} size={14} color={isView ? m3.onSurface : m3.onPrimary} /> : null}
                <Text style={[styles.actionChipText, isView ? styles.actionChipTextQuiet : styles.actionChipTextPrimary]}>
                  {isWorking ? 'Working…' : action.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </M3Card>
    );
  };

  return (
    <M3Screen
      header={header}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={m3.primary} />}
    >
      <View style={styles.titleBlock}>
        <Text style={styles.title}>Today's Dispatch</Text>
        <Text style={styles.subtitle}>{`${total} action${total === 1 ? '' : 's'} in this category`}</Text>
      </View>

      <View style={styles.chipsWrap}>
        {categories.map((item) => (
          <Chip
            key={item.value}
            label={item.label}
            icon={item.icon}
            selected={category === item.value}
            onPress={() => setCategory(item.value)}
          />
        ))}
      </View>

      {loading && !items.length ? (
        <M3Loading label="Loading your action queue…" />
      ) : error && !items.length ? (
        <M3Error message={error} onRetry={() => void load()} />
      ) : !items.length ? (
        <M3Empty icon="task_alt" title="You're caught up" message="No actions in this category right now." />
      ) : (
        <View style={styles.list}>
          {items.map(renderItem)}
          {items.length < total ? (
            <Pressable accessibilityRole="button" disabled={loading} onPress={() => void load(page + 1, true)} style={styles.loadMore}>
              <Text style={styles.loadMoreText}>{loading ? 'Loading…' : 'Load more'}</Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </M3Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  list: { gap: m3Space.sm, paddingBottom: m3Space.lg },

  titleBlock: { gap: 2 },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },

  card: { gap: m3Space.sm },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  itemIcon: { width: 36, height: 36, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  kind: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  customer: { ...m3Type.labelLg, color: m3.onSurface, marginTop: 1 },
  meta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },
  actionChip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 12, borderRadius: m3Radius.sm },
  actionChipPrimary: { backgroundColor: m3.primary },
  actionChipQuiet: { backgroundColor: m3.surfaceContainerLow },
  actionChipText: { ...m3Type.labelMd },
  actionChipTextPrimary: { color: m3.onPrimary },
  actionChipTextQuiet: { color: m3.onSurface },

  loadMore: { height: 44, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  loadMoreText: { ...m3Type.labelMd, color: m3.onSurface },
});
