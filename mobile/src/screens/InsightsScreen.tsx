import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { AttentionCategory, BusinessInsightsDto, CoachingActionLinkDto, CoachingInsightDto, CoachingPriority, ValueCenterDto } from '../apiTypes';
import { Icon, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { ApiError } from '../services/api';
import { dashboardApi } from '../services/endpoints';
import { RootStackParamList } from '../types';
import { audienceCoachingDestination } from '../domain/coachingNavigation';
import { barFractions, changeLabel, lifecycleShares, monthChange, monthHeadline, percent, recoveryTimeCopy, serviceBars, shortMonth, TREND_METRICS, TrendMetric } from '../domain/insightsPresentation';
import { useAuth } from '../state/AuthContext';
import { formatMoney, titleCase } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Insights'>;
type Navigator = Pick<NativeStackNavigationProp<RootStackParamList>, 'navigate'>;

/** Every actionLink the backend can return maps to a screen that already exists (businessCoaching.ts's closed CoachingActionLink type). */
function goToAction(navigation: Navigator, actionLink: CoachingActionLinkDto) {
  if (actionLink.kind === 'attentionCenter') navigation.navigate('AttentionCenter', { category: actionLink.category });
  else if (actionLink.kind === 'customerProfile') navigation.navigate('CustomerProfile', { customerId: actionLink.customerId });
  else if (actionLink.kind === 'comeback') navigation.navigate('Comeback');
  else if (actionLink.kind === 'businessSettings') navigation.navigate('BusinessSettings');
  else if (actionLink.kind === 'audience') { const destination = audienceCoachingDestination(actionLink.audienceKey); navigation.navigate(destination.screen, destination.params); }
  // 'insights' needs no navigation: the insight is already on this screen.
}
const PRIORITY: Record<CoachingPriority, { label: string; color: string; bg: string }> = {
  critical: { label: 'Do first', color: m3.error, bg: m3.errorContainer },
  high: { label: 'Important', color: m3.primary, bg: m3.primaryFixed },
  medium: { label: 'Worth doing', color: m3.tertiary, bg: m3.secondaryContainer },
  low: { label: 'When you can', color: m3.onSurfaceVariant, bg: m3.surfaceContainer },
};
const STAGE_COLORS = [m3.tertiary, m3.primary, m3.secondary, m3.primaryContainer, m3.onSurfaceVariant, m3.outline, m3.error, m3.outlineVariant];

export function InsightsScreen({ navigation }: Props) {
  const { business } = useAuth();
  const currency = business?.currency ?? 'USD';
  const [insights, setInsights] = useState<BusinessInsightsDto | null>(null);
  const [coaching, setCoaching] = useState<CoachingInsightDto[] | null>(null);
  const [value, setValue] = useState<ValueCenterDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metric, setMetric] = useState<TrendMetric>('recoveredRevenue');
  const [showAllActions, setShowAllActions] = useState(false);

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true); else setLoading(true);
    setError(null);
    // Independent calls: coaching and value are supplementary, so a failure in
    // either must not blank the screen when the core insights call succeeds.
    const [insightsResult, coachingResult, valueResult] = await Promise.allSettled([dashboardApi.insights(), dashboardApi.coaching(), dashboardApi.value()]);
    if (insightsResult.status === 'fulfilled') setInsights(insightsResult.value);
    else setError(insightsResult.reason instanceof ApiError ? insightsResult.reason.message : 'Unable to load business insights.');
    setCoaching(coachingResult.status === 'fulfilled' ? coachingResult.value.insights : null);
    setValue(valueResult.status === 'fulfilled' ? valueResult.value : null);
    setLoading(false); setRefreshing(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const header = <M3Header businessName="More" onBack={() => navigation.goBack()} onNotificationsPress={() => navigation.navigate('AttentionCenter')} hasNotifications={false} />;
  const trend = insights?.monthlyTrend ?? [];
  const headline = useMemo(() => (insights ? monthHeadline(insights) : null), [insights]);
  const money = (amount: number | null | undefined) => (amount == null ? '-' : formatMoney(amount, currency));

  if (loading && !insights) return <M3Screen header={header} scroll={false}><M3Loading label="Loading your business insights…" /></M3Screen>;
  if (error && !insights) return <M3Screen header={header} scroll={false}><M3Error message={error} onRetry={() => void load()} /></M3Screen>;
  if (!insights) return <M3Screen header={header} scroll={false}><M3Empty icon="insights" title="No insights yet" message="Insights appear as you add customers, leads and appointments." /></M3Screen>;

  const { servicePerformance, customerValue, recoveryPerformance, customerLifecycle } = insights;
  const goToCustomer = (customerId: string | null) => { if (customerId) navigation.navigate('CustomerProfile', { customerId }); };
  const actions = (coaching ?? []).filter((item) => item.actionLink.kind !== 'insights' || item.priority === 'critical');
  const shownActions = showAllActions ? actions : actions.slice(0, 3);
  const activeMetric = TREND_METRICS.find((item) => item.key === metric)!;
  const trendValues = trend.map((point) => point[metric]);
  const bars = barFractions(trendValues);
  const change = monthChange(trend, metric);
  const changeText = changeLabel(change);
  const revenueBars = serviceBars(servicePerformance.highestRevenue, (row) => row.revenue, money);
  const shares = lifecycleShares(customerLifecycle.counts, customerLifecycle.totalCustomers);
  const outcomes = value?.valueCreated;

  return <M3Screen header={header} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={m3.primary} />}>
    <View style={styles.titleBlock}>
      <Text style={styles.pageTitle}>Business insights</Text>
      <Text style={styles.pageSubtitle}>How your business is doing, and what to do about it.</Text>
    </View>

    <View style={styles.hero} accessible accessibilityLabel={`This month: ${money(trend.at(-1)?.recoveredRevenue ?? 0)} revenue`}>
      <Text style={styles.heroEyebrow}>THIS MONTH</Text>
      <Text style={styles.heroValue}>{money(trend.at(-1)?.recoveredRevenue ?? 0)}</Text>
      <Text style={styles.heroLabel}>revenue recovered by Chakusa</Text>
      {headline ? <Text style={styles.heroHeadline}>{headline}</Text> : null}
      <View style={styles.heroStats}>
        <HeroStat label="New leads" value={String(trend.at(-1)?.newLeads ?? 0)} />
        <HeroStat label="New customers" value={String(trend.at(-1)?.newCustomers ?? 0)} />
        <HeroStat label="Reviews" value={String(trend.at(-1)?.reviewsReceived ?? 0)} />
      </View>
    </View>

    {actions.length > 0 ? <Section title="What to do next" subtitle="The few things most likely to bring in more business right now.">
      {shownActions.map((insight) => {
        const tone = PRIORITY[insight.priority];
        return <View key={insight.key} style={styles.actionCard}>
          <View style={styles.actionTop}>
            <View style={[styles.priorityPill, { backgroundColor: tone.bg }]}><Text style={[styles.priorityText, { color: tone.color }]}>{tone.label}</Text></View>
          </View>
          <Text style={styles.actionTitle}>{insight.title}</Text>
          <Text style={styles.actionBody}>{insight.context}</Text>
          {insight.expectedOutcome ? <Text style={styles.actionOutcome}>{insight.expectedOutcome}</Text> : null}
          {insight.actionLink.kind !== 'insights' ? <Pressable accessibilityRole="button" onPress={() => goToAction(navigation, insight.actionLink)} style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}><Text style={styles.actionButtonText}>{insight.recommendedAction}</Text><Icon name="arrow_forward" size={18} color={m3.onPrimary} /></Pressable> : null}
        </View>;
      })}
      {actions.length > 3 ? <Pressable accessibilityRole="button" onPress={() => setShowAllActions((open) => !open)} style={styles.textButton}><Text style={styles.textButtonLabel}>{showAllActions ? 'Show fewer' : `Show ${actions.length - 3} more`}</Text></Pressable> : null}
    </Section> : null}

    <Section title="Last 6 months" subtitle="Tap a measure to switch the chart.">
      <View style={styles.segment} accessibilityRole="tablist">
        {TREND_METRICS.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: item.key === metric }} onPress={() => setMetric(item.key)} style={[styles.segmentItem, item.key === metric && styles.segmentItemOn]}><Text style={[styles.segmentText, item.key === metric && styles.segmentTextOn]}>{item.label}</Text></Pressable>)}
      </View>
      <View style={styles.chartHead}>
        <Text style={styles.chartValue}>{activeMetric.money ? money(change.current) : String(change.current)}</Text>
        {changeText ? <View style={[styles.deltaPill, change.direction === 'down' ? styles.deltaDown : styles.deltaUp]}><Icon name={change.direction === 'down' ? 'trending_down' : change.direction === 'up' ? 'trending_up' : 'trending_flat'} size={14} color={change.direction === 'down' ? m3.error : m3.tertiary} /><Text style={[styles.deltaText, { color: change.direction === 'down' ? m3.error : m3.tertiary }]}>{changeText} vs last month</Text></View> : null}
      </View>
      <View style={styles.chart} accessible accessibilityLabel={`${activeMetric.label} by month: ${trend.map((point) => `${shortMonth(point.month)} ${point[metric]}`).join(', ')}`}>
        {trend.map((point, index) => <View key={point.month} style={styles.barColumn}>
          <View style={styles.barTrack}><View style={[styles.bar, index === trend.length - 1 && styles.barNow, { height: `${Math.max(bars[index] ?? 0, 0) * 100}%` }]} /></View>
          <Text style={[styles.barLabel, index === trend.length - 1 && styles.barLabelNow]}>{shortMonth(point.month)}</Text>
        </View>)}
      </View>
    </Section>

    {outcomes ? <Section title="Money and work" subtitle="Recorded from your activity. Nothing here is a forecast.">
      <View style={styles.tiles}>
        <Tile icon="payments" label="Collected" value={money(outcomes.revenue.collected)} />
        <Tile icon="replay" label="Recovered" value={money(outcomes.revenue.recovered)} />
        <Tile icon="schedule" label="Still owed" value={money(outcomes.revenue.outstanding)} />
        <Tile icon="event_available" label="Appointments done" value={String(outcomes.appointments.completed)} />
        <Tile icon="star" label="Reviews" value={String(outcomes.reputation.received)} detail={outcomes.reputation.averageRating != null ? `${outcomes.reputation.averageRating.toFixed(1)} average` : undefined} />
        <Tile icon="person_add" label="Customers won back" value={String(outcomes.customers.recovered)} />
      </View>
    </Section> : null}

    {revenueBars.length > 0 ? <Section title="Your best services" subtitle="Ranked by the revenue each one has brought in.">
      <View style={styles.listCard}>{revenueBars.map((row, index) => <View key={row.label} style={styles.serviceRow}>
        <View style={styles.serviceTop}><Text style={styles.serviceRank}>{index + 1}</Text><Text style={styles.serviceName} numberOfLines={1}>{row.label}</Text><Text style={styles.serviceValue}>{row.value}</Text></View>
        <View style={styles.meter}><View style={[styles.meterFill, { width: `${row.fraction * 100}%` }]} /></View>
      </View>)}</View>
      {servicePerformance.lowestConverting.length > 0 ? <Text style={styles.note}>Needs attention: {servicePerformance.lowestConverting.slice(0, 2).map((row) => titleCase(row.service)).join(' and ')} get plenty of enquiries but few turn into bookings.</Text> : null}
    </Section> : null}

    {customerLifecycle.totalCustomers > 0 ? <Section title="Your customers" subtitle={`${customerLifecycle.totalCustomers} customer${customerLifecycle.totalCustomers === 1 ? '' : 's'}, by where they are with you.`}>
      <View style={styles.stack} accessible accessibilityLabel={shares.map((share) => `${share.label} ${share.count}`).join(', ')}>
        {shares.map((share, index) => <View key={share.key} style={{ flex: share.share, backgroundColor: STAGE_COLORS[index % STAGE_COLORS.length] }} />)}
      </View>
      <View style={styles.legend}>
        {shares.map((share, index) => <Pressable key={share.key} accessibilityRole={share.key === 'dormant' ? 'button' : undefined} onPress={share.key === 'dormant' ? () => navigation.navigate('Comeback') : undefined} style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: STAGE_COLORS[index % STAGE_COLORS.length] }]} /><Text style={styles.legendText}>{share.label}</Text><Text style={styles.legendCount}>{share.count}</Text>
        </Pressable>)}
      </View>
      {customerValue.longestInactiveCustomers.length > 0 ? <View style={styles.listCard}>
        <Text style={styles.listTitle}>Haven't been in for a while</Text>
        {customerValue.longestInactiveCustomers.slice(0, 3).map((row) => <Pressable key={row.customerId} accessibilityRole="button" onPress={() => goToCustomer(row.customerId)} style={({ pressed }) => [styles.personRow, pressed && styles.pressed]}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{(row.customerName ?? '?').slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}><Text style={styles.personName}>{row.customerName ?? 'Unnamed customer'}</Text><Text style={styles.personDetail}>{row.daysSinceLastActivity} days since last contact</Text></View>
          <Icon name="chevron_right" size={20} color={m3.onSurfaceVariant} />
        </Pressable>)}
      </View> : null}
    </Section> : null}

    <Section title="How Chakusa is helping" subtitle="Follow-ups and reminders turned into bookings and reviews.">
      <View style={styles.listCard}>
        <Meter label="Missed calls won back" detail={`${recoveryPerformance.missedCallsRecovered} of ${recoveryPerformance.missedCallsTotal}`} fraction={recoveryPerformance.missedCallsTotal ? recoveryPerformance.missedCallsRecovered / recoveryPerformance.missedCallsTotal : 0} />
        <Meter label="Leads that became customers" detail={percent(recoveryPerformance.recoveryConversionRate)} fraction={recoveryPerformance.recoveryConversionRate} />
        <Meter label="Review requests that got a review" detail={percent(recoveryPerformance.reviewRequestSuccessRate)} fraction={recoveryPerformance.reviewRequestSuccessRate ?? 0} />
        <Meter label="Customers who came back after a reminder" detail={percent(recoveryPerformance.reminderCompletionRate)} fraction={recoveryPerformance.reminderCompletionRate ?? 0} />
      </View>
      {recoveryPerformance.averageRecoveryDays != null ? <Text style={styles.note}>{recoveryTimeCopy(recoveryPerformance.averageRecoveryDays)}</Text> : null}
    </Section>
  </M3Screen>;
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return <View style={styles.section}><View style={styles.sectionHead}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}</View>{children}</View>;
}
function HeroStat({ label, value }: { label: string; value: string }) {
  return <View style={styles.heroStat}><Text style={styles.heroStatValue}>{value}</Text><Text style={styles.heroStatLabel}>{label}</Text></View>;
}
function Tile({ icon, label, value, detail }: { icon: string; label: string; value: string; detail?: string }) {
  return <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}${detail ? `, ${detail}` : ''}`}><Icon name={icon} size={20} color={m3.primary} /><Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text><Text style={styles.tileLabel}>{label}</Text>{detail ? <Text style={styles.tileDetail}>{detail}</Text> : null}</View>;
}
function Meter({ label, detail, fraction }: { label: string; detail: string; fraction: number }) {
  return <View style={styles.meterRow}><View style={styles.meterTop}><Text style={styles.meterLabel}>{label}</Text><Text style={styles.meterDetail}>{detail}</Text></View><View style={styles.meter}><View style={[styles.meterFill, { width: `${Math.min(Math.max(fraction, 0), 1) * 100}%` }]} /></View></View>;
}

const styles = StyleSheet.create({
  titleBlock: { gap: 2 },
  pageTitle: { ...m3Type.headlineMd, color: m3.onSurface },
  pageSubtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  pressed: { opacity: 0.8 },
  hero: { backgroundColor: m3.primary, borderRadius: m3Radius.xl, padding: m3Space.lg, gap: 4 },
  heroEyebrow: { ...m3Type.labelSm, color: m3.onPrimary, opacity: 0.8, letterSpacing: 1.2 },
  heroValue: { ...m3Type.displayMobile, color: m3.onPrimary },
  heroLabel: { ...m3Type.bodyMd, color: m3.onPrimary, opacity: 0.9 },
  heroHeadline: { ...m3Type.labelLg, color: m3.onPrimary, marginTop: m3Space.xs },
  heroStats: { flexDirection: 'row', gap: m3Space.sm, marginTop: m3Space.sm },
  heroStat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: m3Radius.lg, paddingVertical: m3Space.sm, paddingHorizontal: m3Space.sm, gap: 2 },
  heroStatValue: { ...m3Type.titleMd, color: m3.onPrimary },
  heroStatLabel: { ...m3Type.bodySm, color: m3.onPrimary, opacity: 0.9 },
  section: { gap: m3Space.sm },
  sectionHead: { gap: 2 },
  sectionTitle: { ...m3Type.titleMd, color: m3.onSurface },
  sectionSubtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  actionCard: { backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.xl, padding: m3Space.md, gap: m3Space.xs, borderWidth: 1, borderColor: m3.outlineVariant },
  actionTop: { flexDirection: 'row' },
  priorityPill: { borderRadius: m3Radius.full, paddingHorizontal: m3Space.sm, paddingVertical: 3 },
  priorityText: { ...m3Type.labelSm },
  actionTitle: { ...m3Type.titleMd, color: m3.onSurface },
  actionBody: { ...m3Type.bodyMd, color: m3.onSurface },
  actionOutcome: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  actionButton: { minHeight: 48, borderRadius: m3Radius.full, backgroundColor: m3.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: m3Space.md, marginTop: m3Space.xs },
  actionButtonText: { ...m3Type.labelLg, color: m3.onPrimary },
  textButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  textButtonLabel: { ...m3Type.labelLg, color: m3.primary },
  segment: { flexDirection: 'row', backgroundColor: m3.surfaceContainer, borderRadius: m3Radius.full, padding: 3 },
  segmentItem: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: m3Radius.full, paddingHorizontal: 4 },
  segmentItemOn: { backgroundColor: m3.surfaceContainerLowest },
  segmentText: { ...m3Type.labelSm, color: m3.onSurfaceVariant },
  segmentTextOn: { color: m3.primary },
  chartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m3Space.sm, flexWrap: 'wrap' },
  chartValue: { ...m3Type.headlineMd, color: m3.onSurface },
  deltaPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: m3Radius.full, paddingHorizontal: m3Space.sm, paddingVertical: 4 },
  deltaUp: { backgroundColor: m3.secondaryContainer },
  deltaDown: { backgroundColor: m3.errorContainer },
  deltaText: { ...m3Type.labelSm },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: m3Space.xs, height: 150, backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.xl, padding: m3Space.md },
  barColumn: { flex: 1, height: '100%', alignItems: 'center', gap: 6 },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end', alignItems: 'center' },
  bar: { width: '70%', minHeight: 0, borderRadius: 6, backgroundColor: m3.primaryFixed },
  barNow: { backgroundColor: m3.primary },
  barLabel: { ...m3Type.labelSm, color: m3.onSurfaceVariant },
  barLabelNow: { color: m3.primary },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.sm },
  tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.xl, padding: m3Space.md, gap: 2 },
  tileValue: { ...m3Type.headlineMd, color: m3.onSurface },
  tileLabel: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  tileDetail: { ...m3Type.labelSm, color: m3.tertiary },
  listCard: { backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.xl, padding: m3Space.md, gap: m3Space.md },
  listTitle: { ...m3Type.labelLg, color: m3.onSurface },
  serviceRow: { gap: 6 },
  serviceTop: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  serviceRank: { ...m3Type.labelSm, color: m3.primary, width: 14 },
  serviceName: { ...m3Type.bodyMd, color: m3.onSurface, flex: 1 },
  serviceValue: { ...m3Type.labelLg, color: m3.onSurface },
  meterRow: { gap: 6 },
  meterTop: { flexDirection: 'row', justifyContent: 'space-between', gap: m3Space.sm },
  meterLabel: { ...m3Type.bodyMd, color: m3.onSurface, flex: 1 },
  meterDetail: { ...m3Type.labelLg, color: m3.onSurface },
  meter: { height: 8, borderRadius: 4, backgroundColor: m3.surfaceContainer, overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 4, backgroundColor: m3.primary },
  note: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  stack: { flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', gap: 2 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { ...m3Type.bodySm, color: m3.onSurface },
  legendCount: { ...m3Type.labelMd, color: m3.onSurfaceVariant },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, minHeight: 52 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: m3.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...m3Type.labelLg, color: m3.onPrimaryFixedVariant },
  personName: { ...m3Type.labelLg, color: m3.onSurface },
  personDetail: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
});
