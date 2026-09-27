import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { InvoiceListItemDto, InvoiceStatus } from '../apiTypes';
import { invoiceStatusLabel, isInvoiceOverdue } from '../domain/invoices';
import { ApiError } from '../services/api';
import { invoicesApi } from '../services/endpoints';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { RootStackParamList } from '../types';
import { formatDate, formatMoney } from '../utils/format';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';

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

  const header = (
    <M3Header
      businessName="Invoices"
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      onAvatarPress={() => navigation.navigate('Main', { screen: 'Settings' })}
      hasNotifications={overdueCount > 0}
    />
  );

  if (!entitled) {
    return (
      <M3Screen header={header}>
        <Text style={styles.title}>Invoices</Text>
        <M3Empty
          icon="receipt"
          title="Available on the Business plan"
          message="Upgrade to create invoices, send them with a secure link, and track what's outstanding."
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
          <Text style={styles.title}>Invoices</Text>
          <Text style={styles.subtitle}>Invoices your customers can view securely</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={() => navigation.navigate('InvoiceEditor', {})} style={styles.addBtn}>
          <Icon name="add" size={18} color={m3.onPrimary} />
          <Text style={styles.addText}>New invoice</Text>
        </Pressable>
      </View>

      <View style={styles.metricRow}>
        <Metric label="Drafts" value={draftCount} />
        <Metric label="Sent" value={sentCount} />
        <Metric label="Overdue" value={overdueCount} negative={overdueCount > 0} />
      </View>

      <View style={styles.chipsWrap}>
        {FILTERS.map((f) => (
          <Chip key={f} label={filterLabel(f)} selected={filter === f} onPress={() => setFilter(f)} />
        ))}
      </View>

      {loading ? (
        <M3Loading label="Loading invoices…" />
      ) : error ? (
        <M3Error message={error} onRetry={() => void load()} />
      ) : visible.length === 0 ? (
        <M3Empty
          icon="receipt"
          title={filter === 'all' ? 'No invoices yet' : `No ${filterLabel(filter).toLowerCase()} invoices`}
          message="Create an invoice to bill a customer and share it with a secure link."
        />
      ) : (
        <View style={styles.list}>
          {visible.map((item) => {
            const overdue = isInvoiceOverdue(item);
            return (
              <M3Card key={item.id} onPress={() => navigation.navigate('InvoiceDetail', { invoiceId: item.id })} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.flex}>
                    <Text style={styles.number}>{item.invoiceNumber}</Text>
                    <Text numberOfLines={1} style={styles.context}>
                      {item.customer?.name ?? 'No customer linked'}
                    </Text>
                  </View>
                  <Chip
                    label={overdue ? 'Overdue' : invoiceStatusLabel(item.status)}
                    tone={overdue ? 'error' : item.status === 'SENT' ? 'secondary' : item.status === 'VOID' ? 'error' : 'neutral'}
                  />
                </View>
                <View style={styles.cardBottom}>
                  <Text style={styles.total}>{formatMoney(item.totals.total, item.currency)}</Text>
                  <Text style={[styles.date, overdue && styles.dateOverdue]}>
                    {item.dueDate ? `Due ${formatDate(item.dueDate)}` : `Updated ${formatDate(item.updatedAt)}`}
                  </Text>
                </View>
              </M3Card>
            );
          })}
        </View>
      )}
    </M3Screen>
  );
}

function Metric({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, negative && styles.metricValueNegative]}>{value}</Text>
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
  metricValueNegative: { color: m3.error },
  metricLabel: { ...m3Type.labelSm, color: m3.onSurfaceVariant, marginTop: 2 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },

  card: { gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.xs },
  number: { ...m3Type.labelLg, color: m3.onSurface },
  context: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  total: { ...m3Type.headlineSm, fontSize: 18, color: m3.onSurface },
  date: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  dateOverdue: { color: m3.error },

  upgradeBtn: { height: 48, borderRadius: m3Radius.md, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  upgradeBtnText: { ...m3Type.labelLg, color: m3.onPrimary },
});
