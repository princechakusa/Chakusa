import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { AttentionCategory, BusinessInsightsDto, CoachingActionLinkDto, CoachingInsightDto, CoachingPriority, CustomerLifecycleStage, ServicePerformanceRowDto, ValueCenterDto } from '../apiTypes';
import { MetricCard, SectionHeader, StatusBadge } from '../components/ui';
import { Icon, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { ApiError } from '../services/api';
import { dashboardApi } from '../services/endpoints';
import { RootStackParamList } from '../types';
import { audienceCoachingDestination } from '../domain/coachingNavigation';
import { formatMoney, titleCase } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Insights'>;
type Navigator = Pick<NativeStackNavigationProp<RootStackParamList>, 'navigate'>;

/** Every actionLink the backend can return maps to a screen that already exists — see businessCoaching.ts's own closed CoachingActionLink type. Nothing here invents a destination. */
function goToAction(navigation: Navigator, actionLink: CoachingActionLinkDto) {
  if (actionLink.kind === 'attentionCenter') navigation.navigate('AttentionCenter', { category: actionLink.category });
  else if (actionLink.kind === 'customerProfile') navigation.navigate('CustomerProfile', { customerId: actionLink.customerId });
  else if (actionLink.kind === 'comeback') navigation.navigate('Comeback');
  else if (actionLink.kind === 'businessSettings') navigation.navigate('BusinessSettings');
  else if (actionLink.kind === 'audience') {
    const destination = audienceCoachingDestination(actionLink.audienceKey);
    navigation.navigate(destination.screen, destination.params);
  }
  // 'insights' needs no navigation — the insight is already on this screen.
}
function priorityTone(priority: CoachingPriority): string {
  return ({ critical: m3.error, high: m3.tertiary, medium: m3.primary, low: m3.onSurfaceVariant } as const)[priority];
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
  const [value, setValue] = useState<ValueCenterDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [insightsResult, coachingResult, valueResult] = await Promise.all([dashboardApi.insights(), dashboardApi.coaching(), dashboardApi.value()]);
      setInsights(insightsResult);
      setCoaching(coachingResult.insights);
      setValue(valueResult);
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to load business insights.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (loading && !insights) return <M3Screen header={<M3Header businessName="More" onBack={() => navigation.goBack()} hasNotifications={false} />} scroll={false}><M3Loading label="Loading your business insights…" /></M3Screen>;
  if (error && !insights) return <M3Screen header={<M3Header businessName="More" onBack={() => navigation.goBack()} hasNotifications={false} />} scroll={false}><M3Error message={error} onRetry={() => void load()} /></M3Screen>;
  if (!insights) return <M3Screen header={<M3Header businessName="More" onBack={() => navigation.goBack()} hasNotifications={false} />} scroll={false}><M3Empty icon="insights" title="No insights yet" message="Insights will appear as you build up business activity." /></M3Screen>;

  const { monthlyTrend, servicePerformance, customerValue, recoveryPerformance, customerLifecycle } = insights;
  const hasAnyServiceData = servicePerformance.mostRequested.length > 0;
  const goToCustomer = (customerId: string | null) => { if (customerId) navigation.navigate('CustomerProfile', { customerId }); };

  return <M3Screen header={<M3Header businessName="More" onBack={() => navigation.goBack()} onNotificationsPress={() => navigation.navigate("AttentionCenter")} hasNotifications={false} />}>
    <View style={styles.titleBlock}><Text style={styles.pageTitle}>Business Insights</Text><Text style={styles.pageSubtitle}>How your business is performing, in your own numbers.</Text></View>

    {value ? <ValueCreated value={value} currency={undefined} navigation={navigation} /> : null}

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
  </M3Screen>;
}

function ValueCreated({ value, currency, navigation }: { value: ValueCenterDto; currency?: string; navigation: Navigator }) {
  const money = (amount: number | null) => amount == null ? 'Unknown' : formatMoney(amount, currency);
  return <View>
    <SectionHeader title="Value created" />
    <Text style={styles.caption}>Recorded outcomes from Chakusa activity. Unknown means the current data does not support attribution.</Text>
    <View style={styles.metricGrid}>
      <MetricCard label="Revenue collected" value={money(value.valueCreated.revenue.collected)} />
      <MetricCard label="Revenue recovered" value={money(value.valueCreated.revenue.recovered)} />
      <MetricCard label="Outstanding revenue" value={money(value.valueCreated.revenue.outstanding)} />
      <MetricCard label="Customers returned" value={String(value.valueCreated.customers.recovered)} />
      <MetricCard label="Appointments completed" value={String(value.valueCreated.appointments.completed)} />
      <MetricCard label="Reviews received" value={String(value.valueCreated.reputation.received)} />
    </View>
    <View style={styles.subsection}>
      <Text style={styles.subsectionTitle}>Automation ROI funnel</Text>
      {value.automationRoi.length === 0 ? <Text style={styles.muted}>No automation runs have been recorded yet.</Text> : value.automationRoi.map(row => <View key={row.triggerType} style={styles.rankRow}><Text style={styles.rankLabel}>{titleCase(row.triggerType.replaceAll('_', ' '))}</Text><Text style={styles.rankValue}>{row.scheduled} scheduled · {row.sent} sent · {row.delivered} delivered</Text></View>)}
    </View>
      {value.opportunities.length > 0 ? <View style={styles.subsection}><Text style={styles.subsectionTitle}>Top opportunities</Text>{value.opportunities.slice(0, 4).map(item => <Pressable key={item.key} accessibilityRole="button" onPress={() => { if (item.action.kind === 'attention' && item.action.category) navigation.navigate('AttentionCenter', { category: item.action.category as AttentionCategory }); else if (item.action.kind === 'comeback') navigation.navigate('Comeback'); else if (item.action.audienceKey === 'dormant') navigation.navigate('Comeback'); }} style={styles.row}><View style={styles.rowCopy}><Text style={styles.rowTitle}>{item.suggestedAction}</Text><Text style={styles.rowDetail}>{item.count} item{item.count === 1 ? '' : 's'} · {item.businessImpact == null ? 'Impact unknown' : `${money(item.businessImpact)} recorded impact`}</Text></View><StatusBadge label={titleCase(item.priority)} /></Pressable>)}</View> : null}
  </View>;
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
  titleBlock: { gap: 2, marginBottom: m3Space.xs },
  pageTitle: { ...m3Type.headlineMd, color: m3.onSurface },
  pageSubtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  caption: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: -m3Space.xs, marginBottom: m3Space.sm },
  muted: { ...m3Type.bodyMd, color: m3.onSurfaceVariant },
  trendList: { backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.lg, paddingHorizontal: m3Space.md },
  trendRow: { minHeight: 56, justifyContent: "center", borderBottomWidth: 1, borderBottomColor: m3.surfaceContainerHigh, paddingVertical: m3Space.xs },
  trendMonth: { ...m3Type.labelLg, color: m3.onSurface },
  trendDetail: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
  subsection: { marginTop: m3Space.sm },
  subsectionTitle: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.5, marginBottom: m3Space.xs },
  rankRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: m3Space.sm, backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.md, paddingHorizontal: m3Space.md, marginBottom: m3Space.xs },
  rankIndex: { ...m3Type.labelSm, color: m3.primary, width: 16, letterSpacing: 0 },
  rankLabel: { ...m3Type.bodyMd, color: m3.onSurface, flex: 1 },
  rankValue: { ...m3Type.labelMd, color: m3.onSurface },
  row: { minHeight: 52, justifyContent: "center", backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.md, paddingHorizontal: m3Space.md, marginBottom: m3Space.xs },
  rowPressed: { opacity: 0.72 },
  rowCopy: { gap: 2 },
  rowTitle: { ...m3Type.labelLg, color: m3.onSurface },
  rowDetail: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: m3Space.sm, marginTop: m3Space.sm },
  lifecycleGrid: { flexDirection: "row", flexWrap: "wrap", gap: m3Space.xs, marginTop: m3Space.sm },
  lifecycleChip: { minHeight: 52, alignItems: "center", justifyContent: "center", backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.md, paddingHorizontal: m3Space.md, paddingVertical: m3Space.xs, gap: 2 },
  lifecycleCount: { ...m3Type.labelLg, color: m3.onSurface },
  lifecycleLabel: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  coachingCard: { backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.lg, padding: m3Space.md, gap: m3Space.xs, marginBottom: m3Space.sm },
  coachingHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: m3Space.sm },
  coachingTitle: { ...m3Type.labelLg, color: m3.onSurface, flex: 1 },
  coachingContext: { ...m3Type.bodyMd, color: m3.onSurface },
  coachingBody: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  evidenceList: { gap: 2 },
  evidenceLine: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  coachingOutcome: { ...m3Type.bodySm, color: m3.onSurface, fontStyle: "italic" },
  coachingAction: { minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: m3Radius.full, borderWidth: 1, marginTop: m3Space.xs, paddingHorizontal: m3Space.md },
  coachingActionText: { ...m3Type.labelMd },
});
