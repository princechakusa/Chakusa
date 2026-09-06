import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { InvoiceListItemDto, InvoiceStatus } from '../apiTypes';
import { AppHeader, EmptyState, ErrorState, FilterTabs, IconButton, LoadingState, PrimaryButton, Screen, StatusBadge } from '../components/ui';
import { invoiceStatusLabel, isInvoiceOverdue } from '../domain/invoices';
import { ApiError } from '../services/api';
import { invoicesApi } from '../services/endpoints';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDate, formatMoney } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Invoices'>;

const FILTERS = ['all', 'DRAFT', 'SENT', 'VOID'] as const;
type Filter = (typeof FILTERS)[number];
const filterLabel = (f: Filter) => (f === 'all' ? 'All' : invoiceStatusLabel(f));

export function InvoicesScreen({ navigation }: Props) {
  const { features } = usePlanExperience();
  const entitled = features?.invoicing ?? false;

  const [items, setItems] = useState<InvoiceListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    if (!entitled) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const response = await invoicesApi.list({ pageSize: 100 });
      setItems(response.items);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to load invoices.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [entitled]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => void load());
    return unsubscribe;
  }, [navigation, load]);

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((item) => item.status === (filter as InvoiceStatus))),
    [items, filter],
  );
  const draftCount = items.filter((item) => item.status === 'DRAFT').length;
  const sentCount = items.filter((item) => item.status === 'SENT').length;
  const overdueCount = items.filter((item) => isInvoiceOverdue(item)).length;

  if (!entitled) {
    return (
      <Screen>
        <AppHeader title="Invoices" subtitle="Send invoices your customers can view with a secure link" />
        <EmptyState
          title="Available on the Business plan"
          message="Upgrade to create invoices, send them with a secure link, and track what's outstanding."
          icon="receipt-outline"
        />
        <PrimaryButton fullWidth label="See plans" onPress={() => navigation.navigate('Pro')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader
        title="Invoices"
        subtitle="Invoices your customers can view securely"
        right={<IconButton icon="add" label="New invoice" onPress={() => navigation.navigate('InvoiceEditor', {})} />}
      />
      <View style={styles.metrics}>
        <Metric label="Drafts" value={draftCount} />
        <Metric label="Sent" value={sentCount} />
        <Metric label="Overdue" value={overdueCount} tone={overdueCount > 0 ? 'negative' : undefined} />
      </View>
      <FilterTabs options={FILTERS} value={filter} onChange={setFilter} />
      {loading ? (
        <LoadingState label="Loading invoices…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No invoices yet' : `No ${filterLabel(filter).toLowerCase()} invoices`}
          message="Create an invoice to bill a customer and share it with a secure link."
          icon="receipt-outline"
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        >
          {visible.map((item) => {
            const overdue = isInvoiceOverdue(item);
            return (
              <Pressable key={item.id} style={styles.card} onPress={() => navigation.navigate('InvoiceDetail', { invoiceId: item.id })}>
                <View style={styles.cardTop}>
                  <Text style={styles.number}>{item.invoiceNumber}</Text>
                  <StatusBadge label={overdue ? 'Overdue' : invoiceStatusLabel(item.status)} />
                </View>
                <Text style={styles.type}>{item.customer?.name ?? 'No customer linked'}</Text>
                <View style={styles.cardBottom}>
                  <Text style={styles.total}>{formatMoney(item.totals.total, item.currency)}</Text>
                  <Text style={[styles.date, overdue && styles.dateOverdue]}>
                    {item.dueDate ? `Due ${formatDate(item.dueDate)}` : `Updated ${formatDate(item.updatedAt)}`}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </Screen>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'negative' }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, tone === 'negative' && styles.metricValueNegative]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  metricValue: { ...typography.heading, color: colors.text },
  metricValueNegative: { color: colors.negative },
  metricLabel: { ...typography.caption, color: colors.textSecondary },
  list: { gap: spacing.sm, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  number: { ...typography.bodyStrong, color: colors.text },
  type: { ...typography.caption, color: colors.textSecondary },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  total: { ...typography.subheading, color: colors.text },
  date: { ...typography.caption, color: colors.textSecondary },
  dateOverdue: { color: colors.negative },
});
