import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { BusinessInsightsDto, ServicePerformanceRowDto } from '../apiTypes';
import { AppHeader, EmptyState, ErrorState, LoadingState, MetricCard, Screen, SectionHeader } from '../components/ui';
import { ApiError } from '../services/api';
import { dashboardApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatMoney, titleCase } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Insights'>;

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(`${month}-01T00:00:00Z`));
}
function pct(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

export function InsightsScreen({ navigation }: Props) {
  const [insights, setInsights] = useState<BusinessInsightsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setInsights(await dashboardApi.insights()); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to load business insights.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading && !insights) return <Screen><LoadingState label="Loading your business insights…" /></Screen>;
  if (error && !insights) return <Screen><ErrorState message={error} onRetry={() => void load()} /></Screen>;
  if (!insights) return <Screen><EmptyState title="No insights yet" message="Insights will appear as you build up business activity." /></Screen>;

  const { monthlyTrend, servicePerformance, customerValue, recoveryPerformance } = insights;
  const hasAnyServiceData = servicePerformance.mostRequested.length > 0;
  const goToCustomer = (customerId: string | null) => { if (customerId) navigation.navigate('CustomerProfile', { customerId }); };

  return <Screen>
    <AppHeader eyebrow="GROWTH" title="Business Insights" subtitle="How your business is performing, in your own numbers" />

    <View>
      <SectionHeader title="Growth trend" />
      <Text style={styles.caption}>New leads, won jobs, new customers, and recovered revenue for each of the last 6 months.</Text>
      <View style={styles.trendList}>
        {monthlyTrend.map(point => <View key={point.month} style={styles.trendRow}>
          <Text style={styles.trendMonth}>{monthLabel(point.month)}</Text>
          <Text style={styles.trendDetail}>{point.newLeads} lead{point.newLeads === 1 ? '' : 's'} · {point.wonLeads} won{point.conversionRate != null ? ` (${pct(point.conversionRate)})` : ''} · {point.newCustomers} new customer{point.newCustomers === 1 ? '' : 's'} · {formatMoney(point.recoveredRevenue)} recovered</Text>
        </View>)}
      </View>
    </View>

    <View>
      <SectionHeader title="Service performance" />
      <Text style={styles.caption}>Ranked from your own lead history. Conversion rankings need at least 3 leads for a service to be included.</Text>
      {!hasAnyServiceData ? <Text style={styles.muted}>Add a service when creating a lead to see performance by service.</Text> : <>
        <ServiceList title="Most requested" rows={servicePerformance.mostRequested} metric="requests" />
        <ServiceList title="Highest revenue" rows={servicePerformance.highestRevenue} metric="revenue" />
        <ServiceList title="Highest converting" rows={servicePerformance.highestConverting} metric="conversion" />
        <ServiceList title="Needs attention" rows={servicePerformance.lowestConverting} metric="conversion" />
      </>}
    </View>

    <View>
      <SectionHeader title="Customer value" />
      <Text style={styles.caption}>Who's coming back fastest, who hasn't been seen in a while, and who's generated the most revenue.</Text>
      <CustomerList title="Fastest returning" rows={customerValue.fastestReturningCustomers} onPress={goToCustomer} render={r => `${Math.round(r.averageDaysBetweenWins)} days between visits`} />
      <CustomerList title="Longest inactive" rows={customerValue.longestInactiveCustomers} onPress={goToCustomer} render={r => `${r.daysSinceLastActivity} days since last contact`} />
      {customerValue.atRiskCustomers.length > 0 ? <View style={styles.subsection}><Text style={styles.subsectionTitle}>At risk ({customerValue.atRiskCustomers.length})</Text>{customerValue.atRiskCustomers.slice(0, 5).map(c => <Row key={c.customerId} onPress={() => goToCustomer(c.customerId)} title={c.customerName ?? 'Unassigned customer'} detail="Overdue for a comeback reminder" />)}</View> : null}
    </View>

    <View>
      <SectionHeader title="Recovery performance" />
      <Text style={styles.caption}>How effectively Chakusa itself is turning missed calls and reminders into business.</Text>
      <View style={styles.metricGrid}>
        <MetricCard label="Missed calls recovered" value={`${recoveryPerformance.missedCallsRecovered}/${recoveryPerformance.missedCallsTotal}`} />
        <MetricCard label="Recovery success rate" value={pct(recoveryPerformance.recoverySuccessRate)} detail="Leads followed up on" />
        <MetricCard label="Conversion rate" value={pct(recoveryPerformance.recoveryConversionRate)} detail="Leads that became customers" />
        <MetricCard label="Review success rate" value={pct(recoveryPerformance.reviewRequestSuccessRate)} detail="Requests that became reviews" />
        <MetricCard label="Reminder completion" value={pct(recoveryPerformance.reminderCompletionRate)} detail="Comebacks that returned" />
        <MetricCard label="Avg. recovery time" value={recoveryPerformance.averageRecoveryDays == null ? '—' : `${Math.round(recoveryPerformance.averageRecoveryDays)}d`} detail="Lead to won" />
      </View>
    </View>
  </Screen>;
}

function ServiceList({ title, rows, metric }: { title: string; rows: ServicePerformanceRowDto[]; metric: 'requests' | 'revenue' | 'conversion' }) {
  if (rows.length === 0) return null;
  return <View style={styles.subsection}>
    <Text style={styles.subsectionTitle}>{title}</Text>
    {rows.map((row, index) => <View key={row.service} style={styles.rankRow}>
      <Text style={styles.rankIndex}>{index + 1}</Text>
      <Text style={styles.rankLabel} numberOfLines={1}>{titleCase(row.service)}</Text>
      <Text style={styles.rankValue}>{metric === 'requests' ? `${row.leadCount} leads` : metric === 'revenue' ? formatMoney(row.revenue) : pct(row.conversionRate)}</Text>
    </View>)}
  </View>;
}

function CustomerList<T extends { customerId: string; customerName: string | null }>({ title, rows, onPress, render }: { title: string; rows: T[]; onPress: (customerId: string | null) => void; render: (row: T) => string }) {
  if (rows.length === 0) return null;
  return <View style={styles.subsection}>
    <Text style={styles.subsectionTitle}>{title}</Text>
    {rows.map(row => <Row key={row.customerId} onPress={() => onPress(row.customerId)} title={row.customerName ?? 'Unassigned customer'} detail={render(row)} />)}
  </View>;
}

function Row({ title, detail, onPress }: { title: string; detail: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
    <View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowDetail}>{detail}</Text></View>
  </Pressable>;
}

const styles = StyleSheet.create({
  caption: { ...typography.caption, color: colors.textSecondary, marginTop: -spacing.xs, marginBottom: spacing.sm },
  muted: { ...typography.body, color: colors.textSecondary },
  trendList: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  trendRow: { minHeight: 56, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.divider, paddingVertical: spacing.xs },
  trendMonth: { ...typography.bodyStrong, color: colors.text },
  trendDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  subsection: { marginTop: spacing.sm },
  subsectionTitle: { ...typography.caption, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: spacing.xs },
  rankRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  rankIndex: { ...typography.caption, color: colors.primary, fontWeight: '700', width: 16 },
  rankLabel: { ...typography.body, color: colors.text, flex: 1 },
  rankValue: { ...typography.bodyStrong, color: colors.text },
  row: { minHeight: 52, justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  rowPressed: { opacity: 0.72 },
  rowCopy: { gap: 2 },
  rowTitle: { ...typography.bodyStrong, color: colors.text },
  rowDetail: { ...typography.caption, color: colors.textSecondary },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
});
