import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { QuoteDocumentStatus, QuoteListItemDto } from '../apiTypes';
import { AppHeader, EmptyState, ErrorState, FilterTabs, IconButton, LoadingState, PrimaryButton, Screen, StatusBadge } from '../components/ui';
import { documentTypeLabel, quoteContextLabel, quoteStatusLabel } from '../domain/quotes';
import { ApiError } from '../services/api';
import { quotesApi } from '../services/endpoints';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDate, formatMoney } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Quotes'>;

const FILTERS = ['all', 'DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED'] as const;
type Filter = (typeof FILTERS)[number];
const filterLabel = (f: Filter) => (f === 'all' ? 'All' : quoteStatusLabel(f));

export function QuotesScreen({ navigation }: Props) {
  const { features } = usePlanExperience();
  const entitled = features?.quotesEstimates ?? false;

  const [items, setItems] = useState<QuoteListItemDto[]>([]);
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
      const response = await quotesApi.list({ pageSize: 100 });
      setItems(response.items);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to load quotes.');
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
    () => (filter === 'all' ? items : items.filter((item) => item.status === (filter as QuoteDocumentStatus))),
    [items, filter],
  );
  const draftCount = items.filter((item) => item.status === 'DRAFT').length;
  const sentCount = items.filter((item) => item.status === 'SENT').length;
  const acceptedCount = items.filter((item) => item.status === 'ACCEPTED').length;

  if (!entitled) {
    return (
      <Screen>
        <AppHeader title="Quotes & Estimates" subtitle="Send priced quotes your customers can accept" />
        <EmptyState
          title="Available on the Business plan"
          message="Upgrade to create quotes and estimates, send them with a secure link, and track acceptance."
          icon="document-text-outline"
        />
        <PrimaryButton fullWidth label="See plans" onPress={() => navigation.navigate('Pro')} />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppHeader
        title="Quotes & Estimates"
        subtitle="Priced quotes your customers can accept"
        right={<IconButton icon="add" label="New quote" onPress={() => navigation.navigate('QuoteEditor', {})} />}
      />
      <View style={styles.metrics}>
        <Metric label="Drafts" value={draftCount} />
        <Metric label="Sent" value={sentCount} />
        <Metric label="Accepted" value={acceptedCount} />
      </View>
      <FilterTabs options={FILTERS} value={filter} onChange={setFilter} />
      {loading ? (
        <LoadingState label="Loading quotes…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : visible.length === 0 ? (
        <EmptyState
          title={filter === 'all' ? 'No quotes yet' : `No ${filterLabel(filter).toLowerCase()} quotes`}
          message="Create a quote or estimate to send a customer a priced offer they can accept."
          icon="document-text-outline"
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} />}
        >
          {visible.map((item) => (
            <Pressable key={item.id} style={styles.card} onPress={() => navigation.navigate('QuoteDetail', { quoteId: item.id })}>
              <View style={styles.cardTop}>
                <Text style={styles.number}>{item.documentNumber}</Text>
                <StatusBadge label={quoteStatusLabel(item.status)} />
              </View>
              <Text style={styles.type}>{documentTypeLabel(item.documentType)}{quoteContextLabel(item) ? ` · ${quoteContextLabel(item)}` : ''}</Text>
              <View style={styles.cardBottom}>
                <Text style={styles.total}>{formatMoney(item.totals.total, item.currency)}</Text>
                <Text style={styles.date}>Updated {formatDate(item.updatedAt)}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center' },
  metricValue: { ...typography.heading, color: colors.text },
  metricLabel: { ...typography.caption, color: colors.textSecondary },
  list: { gap: spacing.sm, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  number: { ...typography.bodyStrong, color: colors.text },
  type: { ...typography.caption, color: colors.textSecondary },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xs },
  total: { ...typography.subheading, color: colors.text },
  date: { ...typography.caption, color: colors.textSecondary },
});
