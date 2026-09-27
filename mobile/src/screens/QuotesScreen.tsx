import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { QuoteDocumentStatus, QuoteListItemDto } from '../apiTypes';
import { documentTypeLabel, quoteContextLabel, quoteStatusLabel } from '../domain/quotes';
import { ApiError } from '../services/api';
import { quotesApi } from '../services/endpoints';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { RootStackParamList } from '../types';
import { formatDate, formatMoney } from '../utils/format';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';

type Props = NativeStackScreenProps<RootStackParamList, 'Quotes'>;

const FILTERS = ['all', 'DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'CANCELED', 'EXPIRED'] as const;
type Filter = (typeof FILTERS)[number];
const filterLabel = (f: Filter) => (f === 'all' ? 'All' : quoteStatusLabel(f));

function statusTone(status: QuoteDocumentStatus): 'secondary' | 'neutral' | 'error' | 'primaryFixed' {
  if (status === 'ACCEPTED') return 'secondary';
  if (status === 'DECLINED' || status === 'CANCELED' || status === 'EXPIRED') return 'error';
  if (status === 'SENT') return 'primaryFixed';
  return 'neutral';
}

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
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const item of items) out[item.status] = (out[item.status] ?? 0) + 1;
    return out;
  }, [items]);
  const draftCount = counts.DRAFT ?? 0;
  const sentCount = counts.SENT ?? 0;
  const acceptedCount = counts.ACCEPTED ?? 0;

  const header = (
    <M3Header
      businessName="Quotes & Estimates"
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      onAvatarPress={() => navigation.navigate('Main', { screen: 'Settings' })}
      hasNotifications={draftCount > 0}
    />
  );

  if (!entitled) {
    return (
      <M3Screen header={header}>
        <Text style={styles.title}>Quotes & Estimates</Text>
        <M3Empty
          icon="receipt_long"
          title="Available on the Business plan"
          message="Upgrade to create quotes and estimates, send them with a secure link, and track acceptance."
        />
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Pro')} style={styles.upgradeBtn}>
          <Text style={styles.upgradeBtnText}>See plans</Text>
        </Pressable>
      </M3Screen>
    );
  }

  return (
    <M3Screen header={header} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={m3.primary} />}>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={styles.title}>Quotes & Estimates</Text>
          <Text style={styles.subtitle}>Priced quotes your customers can accept</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('QuoteEditor', {})} style={styles.addBtn}>
          <Icon name="add" size={18} color={m3.onPrimary} />
          <Text style={styles.addText}>New quote</Text>
        </Pressable>
      </View>

      <View style={styles.metricRow}>
        <Metric label="Drafts" value={draftCount} />
        <Metric label="Sent" value={sentCount} />
        <Metric label="Accepted" value={acceptedCount} />
      </View>

      <View style={styles.chipsWrap}>
        {FILTERS.map((f) => (
          <Chip key={f} label={filterLabel(f)} selected={filter === f} onPress={() => setFilter(f)} />
        ))}
      </View>

      {loading ? (
        <M3Loading label="Loading quotes…" />
      ) : error ? (
        <M3Error message={error} onRetry={() => void load()} />
      ) : visible.length === 0 ? (
        <M3Empty
          icon="receipt_long"
          title={filter === 'all' ? 'No quotes yet' : `No ${filterLabel(filter).toLowerCase()} quotes`}
          message="Create a quote or estimate to send a customer a priced offer they can accept."
        />
      ) : (
        <View style={styles.list}>
          {visible.map((item) => (
            <M3Card key={item.id} onPress={() => navigation.navigate('QuoteDetail', { quoteId: item.id })} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.flex}>
                  <Text style={styles.number}>{item.documentNumber}</Text>
                  <Text numberOfLines={1} style={styles.context}>
                    {documentTypeLabel(item.documentType)}
                    {quoteContextLabel(item) ? ` · ${quoteContextLabel(item)}` : ''}
                  </Text>
                </View>
                <Chip label={quoteStatusLabel(item.status)} tone={statusTone(item.status)} />
              </View>
              <View style={styles.cardBottom}>
                <Text style={styles.total}>{formatMoney(item.totals.total, item.currency)}</Text>
                <Text style={styles.date}>Updated {formatDate(item.updatedAt)}</Text>
              </View>
            </M3Card>
          ))}
        </View>
      )}
    </M3Screen>
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
  flex: { flex: 1, minWidth: 0 },
  list: { gap: m3Space.sm },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 38, paddingHorizontal: 12, borderRadius: m3Radius.sm, backgroundColor: m3.primary },
  addText: { ...m3Type.labelMd, color: m3.onPrimary },

  metricRow: { flexDirection: 'row', gap: m3Space.xs },
  metric: { flex: 1, backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.md, padding: m3Space.sm, alignItems: 'center' },
  metricValue: { ...m3Type.headlineSm, color: m3.onSurface },
  metricLabel: { ...m3Type.labelSm, color: m3.onSurfaceVariant, marginTop: 2 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },

  card: { gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.xs },
  number: { ...m3Type.labelLg, color: m3.onSurface },
  context: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { ...m3Type.headlineSm, fontSize: 18, color: m3.onSurface },
  date: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },

  upgradeBtn: { height: 48, borderRadius: m3Radius.md, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  upgradeBtnText: { ...m3Type.labelLg, color: m3.onPrimary },
});
