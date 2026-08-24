import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader, EmptyState, ErrorState, LoadingState, MetricCard, Reveal, Screen, SectionHeader, StatusBadge } from '../components/ui';
import { AppointmentDto, AudienceCenterDto, BusinessHealthLabel, SmartAudienceKey } from '../apiTypes';
import { DashboardAudienceSummary } from '../components/DashboardAudienceSummary';
import { ActivationJourneyCard } from '../components/ActivationJourneyCard';
import { ValueProofCard } from '../components/ValueProofCard';
import { PublicProfileGrowthCard } from '../components/PublicProfileGrowthCard';
import { AUTOMATION_ENABLED } from '../config';
import { automationAvailability, missedCallRules } from '../domain/automation';
import { CallDetectionAvailability } from '../domain/callDetection';
import { dashboardMilestones, Milestone, milestoneCopy, recoveryEngineReadyMilestone, unseenMilestones } from '../domain/milestones';
import { recoveryEngineStatus } from '../domain/recoveryEngineStatus';
import { audienceCoachingDestination } from '../domain/coachingNavigation';
import { endOfDay, startOfDay } from '../domain/calendar';
import { activationJourney } from '../domain/activationJourney';
import { computeSetupScore } from '../domain/setupScore';
import { getCallDetectionAvailability, getContactsPermissionStatus } from '../services/callDetection';
import { appointmentsApi, automationApi, customersApi } from '../services/endpoints';
import { getSeenMilestones, markMilestonesSeen } from '../services/milestoneStorage';
import { getPushPermissionStatus } from '../services/pushNotifications';
import { useAppState } from '../state/AppContext';
import { useAuth } from '../state/AuthContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { usePreferences } from '../state/PreferencesContext';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDateTime, formatMoney, titleCase } from '../utils/format';

export function DashboardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user, business } = useAuth();
  const { attention } = usePreferences();
  const { plan, status: planStatus, features, subscription } = usePlanExperience();
  const { dashboard, leads, reviews, reminders, state, loadDashboard, loadLeads, loadReviews, loadReminders } = useAppState();
  const [callDetectionAvail, setCallDetectionAvail] = useState<CallDetectionAvailability>('unsupported');
  const [hasContactsPermission, setHasContactsPermission] = useState(false);
  const [pushGranted, setPushGranted] = useState(false);
  const [automationEnabled, setAutomationEnabled] = useState(false);
  const [milestone, setMilestone] = useState<Milestone | null>(null);
  const [audiences, setAudiences] = useState<AudienceCenterDto | null>(null);
  const [todayAppointments, setTodayAppointments] = useState<AppointmentDto[]>([]);
  const loadAudiences = useCallback(async () => {
    try { setAudiences(await customersApi.audiences()); }
    catch { setAudiences(null); }
  }, []);
  const loadAppointments = useCallback(async () => { const now = new Date(); try { setTodayAppointments(await appointmentsApi.list(startOfDay(now).toISOString(), endOfDay(now).toISOString())); } catch { setTodayAppointments([]); } }, []);
  useEffect(() => { void Promise.all([loadDashboard(), loadLeads(), loadReviews(), loadReminders(), loadAudiences(), loadAppointments()]); }, [loadAppointments, loadAudiences, loadDashboard, loadLeads, loadReminders, loadReviews]);
  useEffect(() => {
    let active = true;
    void Promise.all([getCallDetectionAvailability(), getContactsPermissionStatus(), getPushPermissionStatus(), automationApi.listRules().catch(() => [])]).then(([detection, contacts, push, rules]) => {
      if (!active) return;
      setCallDetectionAvail(detection);
      setHasContactsPermission(contacts);
      setPushGranted(push === 'granted');
      setAutomationEnabled(missedCallRules(rules).length > 0 && rules.some(rule => rule.enabled));
    });
    return () => { active = false; };
  }, []);

  const automationAvail = automationAvailability(plan, planStatus, features?.automation ?? null, AUTOMATION_ENABLED);
  const engine = recoveryEngineStatus({ callDetection: callDetectionAvail, hasContactsPermission, automationAvailability: automationAvail, automationEnabled, pushGranted });
  const setup = computeSetupScore({ business, automationAvailability: automationAvail, automationConfigured: automationEnabled, pushEnabled: pushGranted });
  const firstIncompleteSetupItem = setup.checklist.find(item => !item.complete);

  useEffect(() => {
    if (!dashboard) return;
    let active = true;
    const reached = [...dashboardMilestones(dashboard), ...recoveryEngineReadyMilestone(engine.overall)];
    if (reached.length === 0) return;
    void getSeenMilestones().then(async seen => {
      if (!active) return;
      const [next] = unseenMilestones(reached, seen);
      if (!next) return;
      setMilestone(milestoneCopy(next));
      await markMilestonesSeen([next]);
    });
    return () => { active = false; };
  }, [dashboard, engine.overall]);

  const initialLoading = !state.dashboard.loaded && state.dashboard.loading;
  const error = state.dashboard.error ?? state.leads.error ?? state.reviews.error ?? state.reminders.error;
  if (initialLoading) return <Screen><LoadingState label="Loading your dashboard..." /></Screen>;
  if (error && !dashboard) return <Screen><ErrorState message={error} onRetry={() => void Promise.all([loadDashboard(), loadLeads(), loadReviews(), loadReminders()])} /></Screen>;
  if (!dashboard) return <Screen><EmptyState title="No dashboard data" message="Your business activity will appear here." /></Screen>;

  const newLeads = attention.missedCalls ? leads.filter(item => item.status === 'new') : [];
  const pendingReviews = attention.reviews ? reviews.filter(item => item.status === 'pending') : [];
  const dueReminders = attention.comebacks ? reminders.filter(item => item.status === 'due' && new Date(item.dueDate) <= new Date()) : [];
  const attentionCount = newLeads.length + pendingReviews.length + dueReminders.length;
  const firstName = user?.fullName.split(' ')[0] ?? 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const refreshing = [state.dashboard, state.leads, state.reviews, state.reminders].some(item => item.loading);
  const activation = activationJourney(dashboard);
  const refresh = () => void Promise.all([loadDashboard(), loadLeads(), loadReviews(), loadReminders(), loadAudiences(), loadAppointments()]);
  const openAudience = (audienceKey: SmartAudienceKey) => {
    const destination = audienceCoachingDestination(audienceKey);
    navigation.navigate(destination.screen, destination.params);
  };

  return <Screen>
    <AppHeader eyebrow={business?.name ?? 'CHAKUSA'} title={`${greeting}, ${firstName}`} subtitle={todayAppointments.length ? `${todayAppointments.length} appointment${todayAppointments.length === 1 ? '' : 's'} today · ${attentionCount} item${attentionCount === 1 ? '' : 's'} need attention` : attentionCount ? `${attentionCount} item${attentionCount === 1 ? '' : 's'} need your attention.` : 'No appointments today · Your recovery work is up to date.'} right={<Pressable accessibilityRole="button" accessibilityLabel="Open calendar" onPress={() => navigation.navigate('Main', { screen: 'Calendar' })} style={styles.attentionButton}><Ionicons name="calendar-outline" size={23} color={colors.text} />{todayAppointments.length ? <View style={styles.count}><Text style={styles.countText}>{todayAppointments.length > 9 ? '9+' : todayAppointments.length}</Text></View> : null}</Pressable>} />

    {milestone ? <Reveal><View accessibilityRole="alert" style={styles.milestone}><Ionicons name="sparkles" size={22} color={colors.surface} /><View style={styles.milestoneCopy}><Text style={styles.milestoneTitle}>{milestone.title}</Text><Text style={styles.milestoneMessage}>{milestone.message}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8} onPress={() => setMilestone(null)}><Ionicons name="close" size={20} color={colors.surface} /></Pressable></View></Reveal> : null}

    <ActivationJourneyCard journey={activation} onContinue={() => { if (activation.next) navigation.navigate('Main', { screen: activation.next.destination }); }} />
    {subscription?.value ? <ValueProofCard value={subscription.value} currency={business?.currency} free={plan === 'FREE'} onPress={() => navigation.navigate(plan === 'FREE' ? 'Pro' : 'Insights')} /> : null}
    {business?.publicSlug ? <PublicProfileGrowthCard businessName={business.name} slug={business.publicSlug} /> : null}

    {setup.score < 100 ? <Pressable accessibilityRole="button" accessibilityLabel="Business setup progress" onPress={() => navigation.navigate('BusinessSettings')} style={styles.engineSummary}>
      <View style={[styles.engineSummaryIcon, { backgroundColor: colors.attention }]}><Ionicons name="clipboard-outline" size={20} color={colors.surface} /></View>
      <View style={styles.engineSummaryCopy}>
        <Text style={styles.engineSummaryTitle}>Business Setup</Text>
        <Text style={styles.engineSummaryDetail}>{firstIncompleteSetupItem ? `Add ${firstIncompleteSetupItem.label.toLowerCase()} to finish setting up your profile.` : 'Finish setting up your business profile.'}</Text>
      </View>
      <StatusBadge label={`${setup.complete}/${setup.total}`} />
    </Pressable> : null}

    <Pressable accessibilityRole="button" accessibilityLabel="Recovery engine status" onPress={() => navigation.navigate('Automation')} style={styles.engineSummary}>
      <View style={styles.engineSummaryIcon}><Ionicons name={engine.overall === 'active' ? 'shield-checkmark' : 'shield-half'} size={20} color={colors.surface} /></View>
      <View style={styles.engineSummaryCopy}>
        <Text style={styles.engineSummaryTitle}>Recovery Engine</Text>
        <Text style={styles.engineSummaryDetail}>{engine.overall === 'active' ? 'Active — Chakusa is watching for missed calls and following up for you.' : `${engine.items.filter(item => item.status === 'attention').length} thing${engine.items.filter(item => item.status === 'attention').length === 1 ? '' : 's'} need your attention to turn this on fully.`}</Text>
      </View>
      <StatusBadge label={engine.overall === 'active' ? 'Active' : 'Needs attention'} />
    </Pressable>

    {dashboard.businessHealth.score != null ? <View style={styles.engineSummary}>
      <View style={[styles.engineSummaryIcon, { backgroundColor: healthColor(dashboard.businessHealth.label) }]}><Ionicons name="pulse" size={20} color={colors.surface} /></View>
      <View style={styles.engineSummaryCopy}>
        <Text style={styles.engineSummaryTitle}>Business Health</Text>
        <Text style={styles.engineSummaryDetail}>{healthMessage(dashboard.businessHealth.label)}</Text>
      </View>
      <StatusBadge label={`${dashboard.businessHealth.score}/100`} />
    </View> : null}

    {dashboard.recommendations.length ? <View style={styles.recommendations}>
      {dashboard.recommendations.map(item => <Pressable accessibilityRole="button" key={item.key} onPress={() => goToRecommendation(navigation, item.key)} style={styles.recommendationRow}><View style={[styles.recommendationDot, item.severity === 'attention' && styles.recommendationDotAttention]} /><Text style={styles.recommendationText}>{item.message}</Text><Ionicons color={colors.tabInactive} name="chevron-forward" size={16} /></Pressable>)}
    </View> : null}

    <Pressable accessibilityRole="button" accessibilityLabel="Business Insights" onPress={() => navigation.navigate('Insights')} style={styles.engineSummary}>
      <View style={[styles.engineSummaryIcon, { backgroundColor: colors.text }]}><Ionicons name="trending-up" size={20} color={colors.surface} /></View>
      <View style={styles.engineSummaryCopy}>
        <Text style={styles.engineSummaryTitle}>Business Insights</Text>
        <Text style={styles.engineSummaryDetail}>See growth trends, top services, and your most valuable customers.</Text>
      </View>
      <Ionicons color={colors.tabInactive} name="chevron-forward" size={18} />
    </Pressable>

    <View>
      <SectionHeader title="Needs action" action="See all" onAction={() => navigation.navigate('AttentionCenter')} />
      {attentionCount ? <View style={styles.actionList}>
        {newLeads[0] ? <ActionRow icon="call-outline" color={colors.primary} title={`Missed call · ${newLeads[0].customer?.name ?? 'Unassigned lead'}`} detail={`${newLeads[0].serviceRequested ?? 'Service not specified'} · ${formatDateTime(newLeads[0].missedCallTime)}`} action="Follow up" onPress={() => navigation.navigate('LeadDetail', { leadId: newLeads[0].id })} /> : null}
        {dueReminders[0] ? <ActionRow icon="refresh-outline" color={colors.attention} title={`Customer due back · ${dueReminders[0].customer?.name ?? 'Unassigned customer'}`} detail={`${dueReminders[0].serviceName ?? 'Service not specified'} · Due ${formatDateTime(dueReminders[0].dueDate)}`} action="Bring back" onPress={() => navigation.navigate('Comeback')} /> : null}
        {pendingReviews[0] ? <ActionRow icon="star-outline" color={colors.success} title={`Review opportunity · ${pendingReviews[0].customer?.name ?? 'Unassigned customer'}`} detail={`${pendingReviews[0].serviceName ?? 'Service not specified'} · ${pendingReviews[0].message ? 'Message prepared' : 'Message needs preparation'}`} action="Request review" onPress={() => navigation.navigate('ReviewDetail', { reviewId: pendingReviews[0].id })} /> : null}
      </View> : <EmptyState title={engine.overall === 'active' ? 'Waiting for your first recovery opportunity' : 'Nothing needs attention yet'} message={dashboard.leads.total === 0 && dashboard.reviews.requestsSent === 0 ? (engine.overall === 'active' ? 'Recovery Engine is active — as soon as a call is missed, Chakusa will catch it here.' : 'Finish setting up your Recovery Engine, or add your first customer to start your recovery workflow.') : "You're caught up for today."} />}
    </View>

    <Reveal delay={80}><View accessibilityLabel={`Recovered revenue ${formatMoney(dashboard.recoveredRevenue.total)}`} style={styles.revenue}><View style={styles.revenueCopy}><Text style={styles.revenueLabel}>RECOVERED REVENUE</Text><Text style={styles.revenueValue}>{formatMoney(dashboard.recoveredRevenue.total)}</Text><Text style={styles.revenueDetail}>{dashboard.recoveredRevenue.total === 0 ? 'Revenue from won leads will appear here.' : 'Calculated from won leads'}</Text></View><View style={styles.revenueIcon}><Ionicons name="trending-up" size={23} color={colors.surface} /></View></View></Reveal>
    <View><SectionHeader title="Lead funnel" />{dashboard.leads.total === 0 ? <Guidance title="No leads yet" message="Add a missed-call lead to start tracking recovery." /> : null}<View style={styles.metricGrid}>{([['Missed calls', dashboard.leads.missedCalls], ['New', dashboard.leads.new], ['Contacted', dashboard.leads.contacted], ['Booked', dashboard.leads.booked], ['Won', dashboard.leads.won], ['Lost', dashboard.leads.lost]] as const).map(([label, value]) => <MetricCard key={label} label={label} value={String(value)} />)}</View></View>
    <View><SectionHeader title="Recovery summary" /><View style={styles.breakdown}><Row label="Missed-call revenue" value={formatMoney(dashboard.recoveredRevenue.missedCall)} /><Row label="Completed comebacks" value={String(dashboard.recoveredRevenue.comebackCompletedCount)} /><Row label="Customers due" value={String(dashboard.customersDue)} /><Row label="Average response" value={dashboard.responseTime.averageSeconds == null ? 'No responses yet' : `${Math.round(dashboard.responseTime.averageSeconds / 60)} min`} last /></View></View>
    <View><SectionHeader title="Customers" />{dashboard.customerIntelligence.totalCustomers === 0 ? <Guidance title="No customers yet" message="Add your first customer to start tracking repeat business." /> : <View style={styles.metricGrid}>
      <MetricCard label="Total customers" value={String(dashboard.customerIntelligence.totalCustomers)} />
      <MetricCard label="New this month" value={String(dashboard.customerIntelligence.newCustomersThisPeriod)} />
      <MetricCard label="Repeat rate" value={dashboard.customerIntelligence.repeatCustomerRate == null ? '—' : `${Math.round(dashboard.customerIntelligence.repeatCustomerRate * 100)}%`} detail={dashboard.customerIntelligence.repeatCustomerRate == null ? 'No won jobs yet' : undefined} />
      <MetricCard label="Avg. customer value" value={dashboard.customerIntelligence.averageLifetimeValue == null ? '—' : formatMoney(dashboard.customerIntelligence.averageLifetimeValue)} />
    </View>}</View>
    {audiences ? <DashboardAudienceSummary data={audiences} onSelect={openAudience} onViewAll={() => navigation.navigate('Main', { screen: 'Customers' })} /> : null}
    <View><SectionHeader title="Reviews" />{dashboard.reviews.requestsSent === 0 && dashboard.reviews.reviewsReceived === 0 && dashboard.reviews.feedbackReceived === 0 ? <Guidance title="Generate your first review" message="Request a review after completing a customer job — it only takes a minute." /> : null}<View style={styles.metricGrid}><MetricCard label="Requests sent" value={String(dashboard.reviews.requestsSent)} /><MetricCard label="Reviews received" value={String(dashboard.reviews.reviewsReceived)} /><MetricCard label="Private feedback" value={String(dashboard.reviews.feedbackReceived)} /></View></View>
    <View><SectionHeader title="Recent activity" action={refreshing ? 'Refreshing...' : 'Refresh'} onAction={refresh} />{dashboard.recentActivity.length ? <View>{dashboard.recentActivity.map(item => <View key={item.id} style={styles.activity}><View style={styles.activityIcon}><Ionicons name="checkmark" size={17} color={colors.success} /></View><View style={styles.activityCopy}><Text style={styles.activityTitle}>{titleCase(item.eventType)}</Text><Text style={styles.activityDetail}>{titleCase(item.entityType)} · {formatDateTime(item.createdAt)}</Text></View></View>)}</View> : <Text style={styles.muted}>Your activity will appear here as you use Chakusa.</Text>}</View>
  </Screen>;
}

function ActionRow({ icon, color, title, detail, action, onPress }: { icon: keyof typeof Ionicons.glyphMap; color: string; title: string; detail: string; action: string; onPress: () => void }) {
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.actionRow, { borderLeftColor: color }, pressed && styles.pressed]}><View style={styles.activityIcon}><Ionicons name={icon} size={19} color={color} /></View><View style={styles.activityCopy}><Text style={styles.activityTitle}>{title}</Text><Text style={styles.activityDetail}>{detail}</Text></View><Text style={[styles.actionText, { color }]}>{action}</Text><Ionicons name="chevron-forward" size={17} color={colors.tabInactive} /></Pressable>;
}
function Row({ label, value, last }: { label: string; value: string; last?: boolean }) { return <View style={[styles.breakdownRow, last && styles.lastRow]}><Text style={styles.breakdownLabel}>{label}</Text><Text style={styles.breakdownValue}>{value}</Text></View>; }
/** One tap from a recommendation straight to where it can be acted on — the exact category tab in Attention Center that has the quick actions for it, or Business Settings for the one recommendation that isn't customer-level. */
function goToRecommendation(navigation: NativeStackNavigationProp<RootStackParamList>, key: string) {
  if (key === 'complete_profile') { navigation.navigate('BusinessSettings'); return; }
  const category = ({ contact_customers: 'missed_call_followup', request_reviews: 'review_opportunity', collect_outstanding_revenue: 'payment_outstanding', bring_back_customers: 'customer_due' } as const)[key as 'contact_customers' | 'request_reviews' | 'collect_outstanding_revenue' | 'bring_back_customers'];
  if (category) navigation.navigate('AttentionCenter', { category });
}
function healthColor(label: BusinessHealthLabel | null) { return label === 'excellent' || label === 'good' ? colors.success : label === 'needs_attention' ? colors.attention : colors.negative; }
function healthMessage(label: BusinessHealthLabel | null) { return ({ excellent: 'Your recovery workflow is performing excellently.', good: 'Your recovery workflow is performing well.', needs_attention: 'A few things could use your attention to improve this.', at_risk: 'Several things need your attention — check Recover, Reputation, and Grow.' } as const)[label ?? 'good']; }
function Guidance({ title, message }: { title: string; message: string }) { return <View style={styles.guidance}><Text style={styles.guidanceTitle}>{title}</Text><Text style={styles.guidanceText}>{message}</Text></View>; }
const styles = StyleSheet.create({
  attentionButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, backgroundColor: colors.negative, borderWidth: 2, borderColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  countText: { fontSize: 10, lineHeight: 12, fontWeight: '700', color: colors.surface },
  actionList: { gap: spacing.xs, marginTop: spacing.sm },
  actionRow: { minHeight: 76, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 4, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  actionText: { ...typography.caption, fontWeight: '700' }, pressed: { opacity: .72 },
  revenue: { minHeight: 160, borderRadius: radius.md, backgroundColor: colors.primary, padding: spacing.xl, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.md }, revenueCopy: { flex: 1 }, revenueLabel: { ...typography.micro, color: colors.surface }, revenueValue: { fontSize: 42, lineHeight: 50, fontWeight: '700', color: colors.surface, marginTop: spacing.sm }, revenueDetail: { ...typography.caption, color: colors.surface, marginTop: spacing.xs }, revenueIcon: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }, breakdown: { marginTop: spacing.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md }, breakdownRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: colors.divider }, lastRow: { borderBottomWidth: 0 }, breakdownLabel: { ...typography.body, color: colors.textSecondary }, breakdownValue: { ...typography.bodyStrong, color: colors.text },
  activity: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider }, activityIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }, activityCopy: { flex: 1, minWidth: 0 }, activityTitle: { ...typography.bodyStrong, color: colors.text }, activityDetail: { ...typography.caption, color: colors.textSecondary }, muted: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm }, guidance: { marginTop: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }, guidanceTitle: { ...typography.bodyStrong, color: colors.text }, guidanceText: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xxs },
  milestone: { minHeight: 72, borderRadius: radius.md, backgroundColor: colors.success, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, milestoneCopy: { flex: 1 }, milestoneTitle: { ...typography.bodyStrong, color: colors.surface }, milestoneMessage: { ...typography.caption, color: colors.surface, marginTop: 2 },
  engineSummary: { minHeight: 68, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }, engineSummaryIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }, engineSummaryCopy: { flex: 1, minWidth: 0 }, engineSummaryTitle: { ...typography.bodyStrong, color: colors.text }, engineSummaryDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  recommendations: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  recommendationRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  recommendationDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginTop: 6 },
  recommendationDotAttention: { backgroundColor: colors.attention },
  recommendationText: { ...typography.caption, color: colors.text, flex: 1 },
});
