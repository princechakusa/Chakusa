import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { BusinessInsightsDto, CoachingActionLinkDto, CoachingInsightDto, CoachingPriority, CustomerLifecycleStage, ServicePerformanceRowDto } from '../apiTypes';
import { AppHeader, EmptyState, ErrorState, LoadingState, MetricCard, Screen, SectionHeader, StatusBadge } from '../components/ui';
import { ApiError } from '../services/api';
import { dashboardApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatMoney, titleCase } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Insights'>;
type Navigator = Pick<NativeStackNavigationProp<RootStackParamList>, 'navigate'>;

/** Every actionLink the backend can return maps to a screen that already exists — see businessCoaching.ts's own closed CoachingActionLink type. Nothing here invents a destination. */
function goToAction(navigation: Navigator, actionLink: CoachingActionLinkDto) {
  if (actionLink.kind === 'attentionCenter') navigation.navigate('AttentionCenter', { category: actionLink.category });
  else if (actionLink.kind === 'customerProfile') navigation.navigate('CustomerProfile', { customerId: actionLink.customerId });
  else if (actionLink.kind === 'comeback') navigation.navigate('Comeback');
  else if (actionLink.kind === 'businessSettings') navigation.navigate('BusinessSettings');
  // 'insights' needs no navigation — the insight is already on this screen.
}
function priorityTone(priority: CoachingPriority): string {
  return ({ critical: colors.negative, high: colors.attention, medium: colors.primary, low: colors.textSecondary } as const)[priority];
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(new Date(`${month}-01T00:00:00Z`));
}
function pct(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

/** Display order/labels for the Customer Lifecycle Automation Engine's stages — zero-count stages are simply omitted, so a small business doesn't see a wall of empty chips. */
const LIFECYCLE_STAGE_LABELS: [CustomerLifecycleStage, string][] = [
  ['new_lead', 'New lead'],
  ['contacted', 'Contacted'],
  ['first_customer', 'First customer'],
  ['returning', 'Returning'],
  ['loyal', 'Loyal'],
  ['vip', 'VIP'],
  ['dormant', 'Dormant'],
  ['lost', 'Lost'],
];

export function InsightsScreen({ navigation }: Props) {
  const [insights, setInsights] = useState<BusinessInsightsDto | null>(null);
  const [coaching, setCoaching] = useState<CoachingInsightDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [insightsResult, coachingResult] = await Promise.all([dashboardApi.insights(), dashboardApi.coaching()]);
      setInsights(insightsResult);
      setCoaching(coachingResult.insights);
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to load business insights.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading && !insights) return <Screen><LoadingState label="Loading your business insights…" /></Screen>;
  if (error && !insights) return <Screen><ErrorState message={error} onRetry={() => void load()} /></Screen>;
  if (!insights) return <Screen><EmptyState title="No insights yet" message="Insights will appear as you build up business activity." /></Screen>;

  const { monthlyTrend, servicePerformance, customerValue, recoveryPerformance, customerLifecycle } = insights;
  const hasAnyServiceData = servicePerformance.mostRequested.length > 0;
  const goToCustomer = (customerId: string | null) => { if (customerId) navigation.navigate('CustomerProfile', { customerId }); };

  return <Screen>
    <AppHeader eyebrow="GROWTH" title="Business Insights" subtitle="How your business is performing, in your own numbers" />

    {coaching && coaching.length > 0 ? <View>
      <SectionHeader title="Coaching" />
      <Text style={styles.caption}>Generated entirely from your own numbers above — what it means, why it matters, and what to do about it.</Text>
      {coaching.map(insight => <View key={insight.key} style={styles.coachingCard}>
        <View style={styles.coachingHeader}><Text style={styles.coachingTitle}>{insight.title}</Text><StatusBadge label={titleCase(insight.priority)} /></View>
        <Text style={styles.coachingContext}>{insight.context}</Text>
        <Text style={styles.coachingBody}>{insight.whyItMatters}</Text>
        <View style={styles.evidenceList}>{insight.evidence.map(line => <Text key={line} style={styles.evidenceLine}>· {line}</Text>)}</View>
        <Text style={styles.coachingOutcome}>{insight.expectedOutcome}</Text>
        {insight.actionLink.kind !== 'insights' ? <Pressable accessibilityRole="button" onPress={() => goToAction(navigation, insight.actionLink)} style={[styles.coachingAction, { borderColor: priorityTone(insight.priority) }]}><Text style={[styles.coachingActionText, { color: priorityTone(insight.priority) }]}>{insight.recommendedAction}</Text></Pressable> : null}
      </View>)}
    </View> : null}

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

    {customerLifecycle.totalCustomers > 0 ? <View>
      <SectionHeader title="Customer lifecycle" />
      <Text style={styles.caption}>Where your {customerLifecycle.totalCustomers} customer{customerLifecycle.totalCustomers === 1 ? '' : 's'} stand right now.</Text>
      <View style={styles.lifecycleGrid}>
        {LIFECYCLE_STAGE_LABELS.filter(([stage]) => customerLifecycle.counts[stage] > 0).map(([stage, label]) => (
          <Pressable
            key={stage}
            accessibilityRole={stage === 'dormant' ? 'button' : undefined}
            onPress={stage === 'dormant' ? () => navigation.navigate('Comeback') : undefined}
            style={styles.lifecycleChip}
          >
            <Text style={styles.lifecycleCount}>{customerLifecycle.counts[stage]}</Text>
            <Text style={styles.lifecycleLabel}>{label}</Text>
          </Pressable>
        ))}
      </View>
    </View> : null}

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
  lifecycleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  lifecycleChip: { minHeight: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: 2 },
  lifecycleCount: { ...typography.bodyStrong, color: colors.text },
  lifecycleLabel: { ...typography.caption, color: colors.textSecondary },
  coachingCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm },
  coachingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  coachingTitle: { ...typography.bodyStrong, color: colors.text, flex: 1 },
  coachingContext: { ...typography.body, color: colors.text },
  coachingBody: { ...typography.caption, color: colors.textSecondary },
  evidenceList: { gap: 2 },
  evidenceLine: { ...typography.caption, color: colors.textSecondary },
  coachingOutcome: { ...typography.caption, color: colors.text, fontStyle: 'italic' },
  coachingAction: { minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.round, borderWidth: 1, marginTop: spacing.xs },
  coachingActionText: { ...typography.caption, fontWeight: '700' },
});
