import { Ionicons } from '../components/icons';
import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { AutomationChannel, AutomationRuleDto, AutomationRunHistoryItemDto } from '../apiTypes';
import { AppHeader, ErrorState, LoadingState, PrimaryButton, Screen, SecondaryButton, StatusBadge } from '../components/ui';
import { LifecycleAutomationCards } from '../components/LifecycleAutomationCards';
import { appendUniqueRuns, AUTOMATION_DELAYS, automationAvailability, automationReasonCopy, automationRunTimestamp, channelLabel, delayLabel, missedCallRules, runStatusCopy, shouldLoadMoreHistory } from '../domain/automation';
import { CallDetectionAvailability } from '../domain/callDetection';
import { EngineItem, recoveryEngineStatus } from '../domain/recoveryEngineStatus';
import { permissionDisclosure, PermissionDisclosureKey } from '../domain/permissionDisclosure';
import { ApiError } from '../services/api';
import { setMissedCallChannel } from '../services/automationSetup';
import { enableCallDetection, enableContactCoverage, getCallDetectionAvailability, getContactsPermissionStatus } from '../services/callDetection';
import { automationApi } from '../services/endpoints';
import { getPushPermissionStatus, registerCurrentDeviceForPush } from '../services/pushNotifications';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { useAuth } from '../state/AuthContext';
import { AUTOMATION_ENABLED } from '../config';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDateTime } from '../utils/format';
import { ProductionWorkflowPanel } from '../components/ProductionWorkflowPanel';
import { MessagingOperationsPanel } from '../components/MessagingOperationsPanel';

type Props = NativeStackScreenProps<RootStackParamList, 'Automation'>;
const HISTORY_PAGE_SIZE = 25;

export function AutomationScreen({ navigation }: Props) {
  const { business, role } = useAuth();
  const { plan, status, features, loading: planLoading, error: planError, refresh: refreshPlan, handleEntitlementError } = usePlanExperience();
  const [rules, setRules] = useState<AutomationRuleDto[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [runs, setRuns] = useState<AutomationRunHistoryItemDto[]>([]);
  const [runTotal, setRunTotal] = useState(0);
  const [runPage, setRunPage] = useState(0);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mutation, setMutation] = useState<'delay'|'toggle'|null>(null);
  const [lifecycleMutation, setLifecycleMutation] = useState<string | null>(null);
  const [selectedDelay, setSelectedDelay] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [callDetectionAvail, setCallDetectionAvail] = useState<CallDetectionAvailability>('unsupported');
  const [hasContactsPermission, setHasContactsPermission] = useState(false);
  const [pushGranted, setPushGranted] = useState(false);
  const [engineWorking, setEngineWorking] = useState<EngineItem['key'] | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const rulesInFlight = useRef<Promise<void> | null>(null);
  const historyGeneration = useRef(0);
  const screenActive = useRef(false);

  const availability = automationAvailability(plan, status, features?.automation ?? null, AUTOMATION_ENABLED);
  const missedRules = missedCallRules(rules);
  const whatsappRule = missedRules.find(item => item.channel === 'WHATSAPP') ?? null;
  const smsRule = missedRules.find(item => item.channel === 'SMS') ?? null;
  const rule = whatsappRule ?? smsRule;
  const engine = recoveryEngineStatus({ callDetection: callDetectionAvail, hasContactsPermission, automationAvailability: availability, automationEnabled: missedRules.some(item => item.enabled), pushGranted, platform: Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web' ? Platform.OS : undefined, callLineNumber: business?.callLineE164 });

  const loadRules = useCallback(async () => {
    if (rulesInFlight.current) return rulesInFlight.current;
    const request = (async () => {
      try { setRules(await automationApi.listRules()); setRuleError(null); }
      catch { setRuleError('Couldn’t load automation settings. Check your connection and try again.'); }
      finally { setRulesLoaded(true); }
    })();
    rulesInFlight.current = request;
    try { await request; } finally { rulesInFlight.current = null; }
  }, []);

  const refreshHistory = useCallback(async () => {
    const generation = ++historyGeneration.current;
    setHistoryLoading(true);
    try {
      const response = await automationApi.listRuns(1, HISTORY_PAGE_SIZE);
      if (generation !== historyGeneration.current) return;
      setRuns(response.items);
      setRunTotal(response.total);
      setRunPage(response.page);
      setHistoryError(null);
    } catch {
      if (generation === historyGeneration.current) setHistoryError('Couldn’t load automation activity.');
    } finally {
      if (generation === historyGeneration.current) { setHistoryLoaded(true); setHistoryLoading(false); }
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (moreLoading || historyLoading || !shouldLoadMoreHistory(runs.length, runTotal)) return;
    const generation = historyGeneration.current;
    setMoreLoading(true);
    try {
      const response = await automationApi.listRuns(runPage + 1, HISTORY_PAGE_SIZE);
      if (generation !== historyGeneration.current) return;
      setRuns(current => appendUniqueRuns(current, response.items));
      setRunTotal(response.total);
      setRunPage(response.page);
      setHistoryError(null);
    } catch { if (generation === historyGeneration.current) setHistoryError('Couldn’t load more automation activity.'); }
    finally { if (generation === historyGeneration.current) setMoreLoading(false); }
  }, [historyLoading, moreLoading, runPage, runTotal, runs.length]);

  const refreshEngineSignals = useCallback(async () => {
    const [detection, contacts, push] = await Promise.all([getCallDetectionAvailability(), getContactsPermissionStatus(), getPushPermissionStatus()]);
    setCallDetectionAvail(detection);
    setHasContactsPermission(contacts);
    setPushGranted(push === 'granted');
  }, []);
  const refreshAll = useCallback(async () => { await Promise.all([loadRules(), refreshHistory(), refreshPlan(), refreshEngineSignals()]); }, [loadRules, refreshHistory, refreshPlan, refreshEngineSignals]);
  useFocusEffect(useCallback(() => { screenActive.current = true; void refreshAll(); return () => { screenActive.current = false; }; }, [refreshAll]));
  useEffect(() => { if (rule && selectedDelay === null) setSelectedDelay(rule.delaySeconds); }, [rule, selectedDelay]);
  useEffect(() => { const listener = AppState.addEventListener('change', next => { if (next === 'active' && screenActive.current) void refreshAll(); }); return () => listener.remove(); }, [refreshAll]);

  const pullToRefresh = async () => { setRefreshing(true); try { await refreshAll(); } finally { setRefreshing(false); } };
  const mutate = async (kind: 'delay'|'toggle', operation: () => Promise<unknown>) => {
    if (mutation) return;
    setMutation(kind); setRuleError(null); setNotice(null);
    try { await operation(); await refreshAll(); }
    catch (caught) { if (!handleEntitlementError(caught)) setRuleError(caught instanceof ApiError && caught.kind === 'network' ? 'Couldn’t reach Chakusa. Your automation setting was not changed.' : 'Chakusa couldn’t update this automation. Please refresh and try again.'); }
    finally { setMutation(null); }
  };
  const saveDelay = () => { if (!rule || selectedDelay === null || availability !== 'available') return; void mutate('delay', () => Promise.all(missedRules.filter(item => item.delaySeconds !== selectedDelay).map(item => automationApi.updateRule(item.id, { delaySeconds: selectedDelay })))); };
  const setChannel = (channel: AutomationChannel, enabled: boolean) => { if (availability !== 'available') return; void mutate('toggle', () => setMissedCallChannel(channel, enabled, selectedDelay ?? 0)); };
  const mutateLifecycle = (key: string, operation: () => Promise<unknown>) => {
    if (lifecycleMutation || mutation) return;
    setLifecycleMutation(key); setRuleError(null); setNotice(null);
    void operation().then(async () => { await refreshAll(); setNotice('Lifecycle automation updated.'); }).catch(caught => {
      if (!handleEntitlementError(caught)) setRuleError(caught instanceof ApiError && caught.kind === 'network' ? 'Couldn’t reach Chakusa. Your lifecycle automation was not changed.' : 'Chakusa couldn’t update this lifecycle automation. Please refresh and try again.');
    }).finally(() => setLifecycleMutation(null));
  };

  const confirmDisclosure = (key: PermissionDisclosureKey) => new Promise<boolean>(resolve => {
    const copy = permissionDisclosure(key);
    Alert.alert(copy.title, copy.body, [
      { text: copy.decline, style: 'cancel', onPress: () => resolve(false) },
      { text: copy.accept, onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });

  const handleEngineAction = async (key: EngineItem['key']) => {
    if (engineWorking) return;
    if ((key === 'detection' || key === 'contactCoverage') && !(await confirmDisclosure(key))) return;
    setEngineWorking(key); setEngineError(null);
    try {
      if (key === 'detection') {
        await enableCallDetection();
      } else if (key === 'contactCoverage') {
        await enableContactCoverage();
      } else if (key === 'notifications') {
        await registerCurrentDeviceForPush();
      } else if (key === 'followUp') {
        if (availability === 'free-locked' || availability === 'subscription-unavailable' || availability === 'service-unavailable') { navigation.navigate('Pro'); return; }
        if (rule && !rule.enabled) await automationApi.enableRule(rule.id);
        // No rule yet: nothing to one-tap here - the "Set up missed-call
        // follow-up" card below (visible on this same screen) is the next
        // step, and duplicating a delay picker inside this summary would
        // be redundant, not a shortcut.
      }
      await refreshAll();
    } catch (caught) {
      if (!handleEntitlementError(caught)) setEngineError(caught instanceof ApiError ? caught.message : 'Unable to update this right now.');
    } finally {
      setEngineWorking(null);
    }
  };

  return <Screen refreshing={refreshing} onRefresh={() => void pullToRefresh()}>
    <AppHeader eyebrow="RECOVERY ENGINE" title="Your recovery engine" subtitle="Everything Chakusa is doing on your behalf, in one place." />
    <ProductionWorkflowPanel canManage={['OWNER','ADMIN'].includes(role ?? '')} />
    <MessagingOperationsPanel />
    <View style={styles.card}>
      <View style={styles.statusRow}>
        <Text style={styles.heading}>Engine status</Text>
        <StatusBadge label={engine.overall === 'active' ? 'Active' : engine.overall === 'attention' ? 'Needs attention' : 'Not started'} />
      </View>
      {engine.items.map(item => <View key={item.key} style={styles.engineRow}>
        <Ionicons name={item.status === 'active' ? 'checkmark-circle' : item.status === 'locked' ? 'lock-closed-outline' : 'alert-circle-outline'} size={22} color={item.status === 'active' ? colors.success : item.status === 'locked' ? colors.textSecondary : colors.attention} />
        <View style={styles.copy}><Text style={styles.engineLabel}>{item.label}</Text><Text style={styles.body}>{item.value}</Text></View>
        {item.action ? <SecondaryButton compact disabled={Boolean(engineWorking)} label={engineWorking === item.key ? 'Working…' : item.action} onPress={() => void handleEngineAction(item.key)} /> : null}
      </View>)}
      {engineError ? <Text accessibilityRole="alert" style={styles.error}>{engineError}</Text> : null}
    </View>
    {availability === 'loading' && planLoading ? <LoadingState label="Checking automation access…" /> : null}
    {availability === 'loading' && !planLoading ? <ErrorState message={planError ?? 'Couldn’t confirm automation access.'} onRetry={() => void refreshPlan()} /> : null}
    {!rulesLoaded ? <LoadingState label="Loading automation…" /> : ruleError && rules.length === 0 ? <ErrorState message={ruleError} onRetry={() => void loadRules()} /> : null}
    {rulesLoaded && availability === 'free-locked' ? <Locked title="Automation is included with Chakusa Pro" body="Your manual missed-call follow-up tools remain available on Free." action="View Pro" onPress={() => navigation.navigate('Pro')} /> : null}
    {rulesLoaded && availability === 'subscription-unavailable' ? <Locked title="Automation is unavailable" body={status === 'EXPIRED' ? 'Your Pro subscription has expired. Existing rule data is preserved, but automation cannot run.' : status === 'CANCELED' ? 'Your Pro subscription is canceled. Existing rule data is preserved, but automation cannot run.' : 'Your current subscription does not include automation.'} action="View plan" onPress={() => navigation.navigate('Pro')} /> : null}
    {rulesLoaded && availability === 'service-unavailable' ? <Locked title="Automation is preparing for launch" body="Automation history remains available, but automatic messages are not running in production yet." action="View plan" onPress={() => navigation.navigate('Pro')} /> : null}
    {rulesLoaded && availability !== 'service-unavailable' && (availability === 'available' || rule) ? <View style={styles.card}>
      <Text style={styles.heading}>Missed-call follow-up</Text>
      <Text style={styles.body}>When a call is missed, Chakusa messages the caller automatically. Turn on WhatsApp, SMS or both; each sends one message per missed-call lead.</Text>
      {([['WHATSAPP', whatsappRule], ['SMS', smsRule]] as const).map(([channel, channelRule]) => <View key={channel} style={styles.statusRow}>
        <View style={styles.copy}><Text style={styles.engineLabel}>{channelLabel(channel)}</Text><Text style={styles.body}>{channelRule?.enabled ? `On · ${delayLabel(channelRule.delaySeconds)}` : 'Off'}</Text></View>
        <Switch accessibilityLabel={`Automatic ${channelLabel(channel)} missed-call follow-up`} accessibilityHint="Turns real automatic customer messages on or off" accessibilityState={{ disabled: availability !== 'available' || Boolean(mutation) }} disabled={availability !== 'available' || Boolean(mutation)} value={channelRule?.enabled ?? false} onValueChange={enabled => setChannel(channel, enabled)} trackColor={{ false: colors.border, true: colors.success }} thumbColor={colors.surface} />
      </View>)}
      <Text style={styles.label}>Delay</Text>
      <DelayPicker value={selectedDelay} disabled={availability !== 'available' || Boolean(mutation)} onChange={setSelectedDelay} />
      {rule ? <PrimaryButton fullWidth disabled={availability !== 'available' || selectedDelay === null || missedRules.every(item => item.delaySeconds === selectedDelay) || Boolean(mutation)} label={mutation === 'delay' ? 'Saving…' : 'Save delay'} onPress={saveDelay} /> : null}
    </View> : null}
    {rulesLoaded ? <LifecycleAutomationCards rules={rules} availability={availability} reminderDays={business?.reminderDays} working={lifecycleMutation} onWork={mutateLifecycle} /> : null}
    {rulesLoaded ? <View style={styles.card}><Text style={styles.heading}>Message</Text><Text style={styles.body}>Chakusa uses the matching lead, review request, or comeback template for each automation. Review your templates before enabling real messages.</Text><SecondaryButton fullWidth label="View message templates" onPress={() => navigation.navigate('Templates')} /></View> : null}
    {status === 'GRACE_PERIOD' && availability === 'available' ? <Text style={styles.notice}>Automation remains available during your current payment grace period.</Text> : null}
    <View style={styles.safety}><Text style={styles.safetyTitle}>Before you turn it on</Text><Text style={styles.safetyText}>Automation sends real customer SMS or WhatsApp messages. Your business is responsible for appropriate consent. Chakusa applies supported opt-out checks, and you can disable this rule here.</Text></View>
    <View style={styles.card}><Text style={styles.heading}>Recent activity</Text>
      {!historyLoaded && historyLoading ? <LoadingState label="Loading automation activity…" /> : null}
      {historyLoaded && historyError && runs.length === 0 ? <ErrorState message="Couldn’t load automation activity." onRetry={() => void refreshHistory()} /> : null}
      {historyLoaded && !historyError && runTotal === 0 ? <View><Text style={styles.emptyTitle}>No automation activity yet</Text><Text style={styles.body}>{availability === 'free-locked' ? 'Activity from automation will appear here if you upgrade and turn it on.' : 'Automatic lead, review, and customer win-back messages will appear here after they start running.'}</Text></View> : null}
      {runs.map(item => <HistoryRow key={item.id} item={item} onPress={item.lead ? () => navigation.navigate('LeadDetail', { leadId: item.lead!.id }) : item.customer ? () => navigation.navigate('CustomerProfile', { customerId: item.customer!.id }) : undefined} />)}
      {runs.length > 0 && historyError ? <Text accessibilityRole="alert" style={styles.error}>{historyError} Existing activity is still shown.</Text> : null}
      {shouldLoadMoreHistory(runs.length, runTotal) ? <SecondaryButton fullWidth disabled={moreLoading} label={moreLoading ? 'Loading more…' : 'Load more'} onPress={() => void loadMore()} /> : null}
    </View>
    {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
    {ruleError && rules.length > 0 ? <Text accessibilityRole="alert" style={styles.error}>{ruleError}</Text> : null}
  </Screen>;
}

function HistoryRow({ item, onPress }: { item: AutomationRunHistoryItemDto; onPress?: () => void }) {
  const status = runStatusCopy(item.status);
  const reason = automationReasonCopy(item.reason);
  const name = item.customer?.name ?? 'Unassigned customer';
  const content = <><View style={styles.activityTop}><View style={styles.copy}><Text style={styles.activityName}>{name}</Text>{item.lead?.serviceRequested ? <Text style={styles.body}>{item.lead.serviceRequested}</Text> : null}</View><Text style={[styles.activityStatus, item.status === 'FAILED' && styles.failed]}>{status}</Text></View><Text style={styles.activityTime}>{formatDateTime(automationRunTimestamp(item))}</Text>{reason ? <Text style={styles.reason}>{reason}</Text> : null}</>;
  const label = `${name}${item.lead?.serviceRequested ? `, ${item.lead.serviceRequested}` : ''}, ${status}, ${formatDateTime(automationRunTimestamp(item))}${reason ? `, ${reason}` : ''}`;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={item.lead ? 'Opens lead details' : 'Opens customer details'} onPress={onPress} style={({ pressed }) => [styles.activity, pressed && styles.pressed]}>{content}</Pressable> : <View accessible accessibilityLabel={label} style={styles.activity}>{content}</View>;
}
function DelayPicker({ value, onChange, disabled }: { value: number | null; onChange: (value: number) => void; disabled: boolean }) { return <View accessibilityRole="radiogroup" accessibilityLabel="Follow-up delay" style={styles.options}>{AUTOMATION_DELAYS.map(seconds => <Pressable key={seconds} accessibilityRole="radio" accessibilityState={{ checked: value === seconds, disabled }} disabled={disabled} onPress={() => onChange(seconds)} style={({ pressed }) => [styles.option, value === seconds && styles.optionSelected, pressed && styles.pressed]}><Text style={[styles.optionText, value === seconds && styles.optionTextSelected]}>{delayLabel(seconds)}</Text></Pressable>)}</View>; }
function Locked({ title, body, action, onPress }: { title: string; body: string; action: string; onPress: () => void }) { return <View style={styles.card}><Text style={styles.heading}>{title}</Text><Text style={styles.body}>{body}</Text><PrimaryButton fullWidth label={action} onPress={onPress} /></View>; }
const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.md }, heading: { ...typography.subheading, color: colors.text }, body: { ...typography.body, color: colors.textSecondary }, label: { ...typography.caption, color: colors.textSecondary }, statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }, copy: { flex: 1, gap: spacing.xs }, engineRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider }, engineLabel: { ...typography.bodyStrong, color: colors.text }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }, option: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.round }, optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft }, optionText: { ...typography.caption, color: colors.textSecondary }, optionTextSelected: { color: colors.primary, fontWeight: '700' }, pressed: { opacity: 0.7 }, safety: { backgroundColor: colors.attentionSoft, borderWidth: 1, borderColor: colors.attention, borderRadius: radius.md, padding: spacing.lg, gap: spacing.xs }, safetyTitle: { ...typography.bodyStrong, color: colors.text }, safetyText: { ...typography.caption, color: colors.textSecondary }, notice: { ...typography.caption, color: colors.textSecondary }, error: { ...typography.caption, color: colors.negative }, emptyTitle: { ...typography.bodyStrong, color: colors.text, marginBottom: spacing.xs }, activity: { minHeight: 56, borderTopWidth: 1, borderTopColor: colors.divider, paddingVertical: spacing.md, gap: spacing.xs }, activityTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }, activityName: { ...typography.bodyStrong, color: colors.text }, activityStatus: { ...typography.caption, color: colors.textSecondary }, failed: { color: colors.negative, fontWeight: '700' }, activityTime: { ...typography.caption, color: colors.textSecondary }, reason: { ...typography.caption, color: colors.textSecondary } });
