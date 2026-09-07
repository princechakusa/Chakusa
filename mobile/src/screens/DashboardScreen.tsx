import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppointmentDto } from '../apiTypes';
import { endOfDay, startOfDay } from '../domain/calendar';
import { appointmentsApi } from '../services/endpoints';
import { useAppState } from '../state/AppContext';
import { useAuth } from '../state/AuthContext';
import { RootStackParamList } from '../types';
import { formatMoney } from '../utils/format';
import { m3, m3Radius, m3Shadow, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen, SectionTitle } from '../experience/businessKit';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const STATUS_TONE: Record<string, { label: string; tone: 'secondary' | 'neutral' | 'primaryFixed' | 'error' }> = {
  SCHEDULED: { label: 'Confirmed', tone: 'neutral' },
  CONFIRMED: { label: 'Confirmed', tone: 'secondary' },
  COMPLETED: { label: 'Completed', tone: 'neutral' },
  CANCELED: { label: 'Canceled', tone: 'error' },
  NO_SHOW: { label: 'No show', tone: 'error' },
};

function initials(name: string | null | undefined) {
  if (!name) return 'WI';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function timeParts(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return { time: `${hour12}:${String(m).padStart(2, '0')}`, ampm: h < 12 ? 'AM' : 'PM' };
}

function minutesUntil(iso: string) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}

export function DashboardScreen() {
  const navigation = useNavigation<Nav>();
  const { user, business } = useAuth();
  const { dashboard, leads, reviews, reminders, state, loadDashboard, loadLeads, loadReviews, loadReminders } = useAppState();
  const [appointments, setAppointments] = useState<AppointmentDto[]>([]);

  const loadAppointments = useCallback(async () => {
    const now = new Date();
    try {
      setAppointments(await appointmentsApi.list(startOfDay(now).toISOString(), endOfDay(now).toISOString()));
    } catch {
      setAppointments([]);
    }
  }, []);

  const refreshAll = useCallback(
    () => Promise.all([loadDashboard(), loadLeads(), loadReviews(), loadReminders(), loadAppointments()]),
    [loadAppointments, loadDashboard, loadLeads, loadReminders, loadReviews],
  );

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const upcoming = useMemo(
    () =>
      appointments
        .filter((a) => a.status !== 'CANCELED' && new Date(a.endsAt).getTime() > Date.now())
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [appointments],
  );
  const [next, ...rest] = upcoming;

  const newLeads = leads.filter((l) => l.status === 'new');
  const pendingReviews = reviews.filter((r) => r.status === 'pending');
  const dueReminders = reminders.filter((r) => r.status === 'due' && new Date(r.dueDate) <= new Date());
  const attention = [
    ...newLeads.map((l) => ({ kind: 'lead' as const, item: l })),
    ...pendingReviews.map((r) => ({ kind: 'review' as const, item: r })),
    ...dueReminders.map((r) => ({ kind: 'reminder' as const, item: r })),
  ];

  const firstName = user?.fullName?.split(' ')[0] ?? 'there';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  const header = (
    <M3Header
      businessName={business?.name ?? 'Chakusa'}
      location={business?.publicSlug ? 'Primary location' : undefined}
      verified={Boolean(business?.publicSlug)}
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      onAvatarPress={() => navigation.navigate('Main', { screen: 'Settings' })}
      hasNotifications={attention.length > 0}
    />
  );

  const initialLoading = !state.dashboard.loaded && state.dashboard.loading;
  const error = state.dashboard.error;
  const refreshing = [state.dashboard, state.leads, state.reviews, state.reminders].some((s) => s.loading);

  if (initialLoading) {
    return (
      <M3Screen header={header} scroll={false}>
        <M3Loading label="Loading your dashboard…" />
      </M3Screen>
    );
  }
  if (error && !dashboard) {
    return (
      <M3Screen header={header} scroll={false}>
        <M3Error message={error} onRetry={() => void refreshAll()} />
      </M3Screen>
    );
  }

  const metrics: { label: string; value: number; accent?: boolean; onPress: () => void }[] = [
    { label: 'Bookings', value: upcoming.length, onPress: () => navigation.navigate('Main', { screen: 'Calendar' }) },
    { label: 'New Leads', value: newLeads.length, accent: newLeads.length > 0, onPress: () => navigation.navigate('Main', { screen: 'Leads' }) },
    { label: 'Reviews', value: pendingReviews.length, onPress: () => navigation.navigate('Main', { screen: 'Reviews' }) },
    { label: 'Due back', value: dueReminders.length, onPress: () => navigation.navigate('Comeback') },
  ];

  const quickActions: { label: string; icon: string; tone: 'primary' | 'neutral'; onPress: () => void }[] = [
    { label: 'New Booking', icon: 'add_circle', tone: 'primary', onPress: () => navigation.navigate('AppointmentEditor') },
    { label: 'New Client', icon: 'person_add', tone: 'neutral', onPress: () => navigation.navigate('Main', { screen: 'Customers' }) },
    { label: 'Estimate', icon: 'receipt_long', tone: 'neutral', onPress: () => navigation.navigate('QuoteEditor') },
    { label: 'Block Time', icon: 'event_busy', tone: 'neutral', onPress: () => navigation.navigate('AvailabilitySettings') },
  ];

  return (
    <M3Screen header={header} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} tintColor={m3.primary} />}>
      <View style={styles.greetingRow}>
        <View style={styles.flex}>
          <Text style={styles.greeting}>{`${greeting}, ${firstName}`}</Text>
          <View style={styles.greetingMetaRow}>
            <Text style={styles.greetingMeta}>{today}</Text>
            {business?.publicSlug ? <Icon name="check_circle" size={13} color={m3.secondary} /> : null}
          </View>
        </View>
        <View style={styles.livePill}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>Studio Live</Text>
        </View>
      </View>

      <M3Card style={styles.metricStrip} padded={false}>
        {metrics.map((m) => (
          <Pressable key={m.label} accessibilityRole="button" onPress={m.onPress} style={styles.metric}>
            {m.accent ? <View style={styles.metricDot} /> : null}
            <Text style={[styles.metricValue, m.accent && { color: m3.primary }]}>{m.value}</Text>
            <Text style={styles.metricLabel}>{m.label}</Text>
          </Pressable>
        ))}
      </M3Card>

      {next ? (
        <View style={styles.gap8}>
          <View style={styles.nextHeadRow}>
            <Text style={styles.eyebrow}>NEXT IN CHAIR</Text>
            <View style={styles.nextInPill}>
              <Text style={styles.nextInText}>
                {(() => {
                  const mins = minutesUntil(next.startsAt);
                  return mins <= 0 ? 'Now' : mins < 60 ? `In ${mins} min` : `In ${Math.round(mins / 60)}h`;
                })()}
              </Text>
            </View>
          </View>
          <M3Card raised style={styles.nextCard}>
            <View style={styles.nextGlow} />
            <View style={styles.nextTopRow}>
              <View style={styles.nextClientRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(next.customer?.name)}</Text>
                </View>
                <View style={styles.flex}>
                  <Text numberOfLines={1} style={styles.nextName}>
                    {next.customer?.name ?? 'Walk-in'}
                  </Text>
                  <Text numberOfLines={1} style={styles.nextService}>
                    {next.serviceName}
                  </Text>
                  <Text style={styles.nextPrice}>
                    {next.price != null ? `${formatMoney(next.price)} · ` : ''}
                    {Math.max(1, Math.round((new Date(next.endsAt).getTime() - new Date(next.startsAt).getTime()) / 60000))} min
                  </Text>
                </View>
              </View>
              <Chip label={STATUS_TONE[next.status]?.label ?? next.status} tone={STATUS_TONE[next.status]?.tone ?? 'neutral'} />
            </View>
            <View style={styles.nextMetaRow}>
              <View style={styles.nextMetaItem}>
                <Icon name="schedule" size={16} color={m3.secondary} />
                <Text style={styles.nextMetaStrong}>
                  {timeParts(next.startsAt).time} {timeParts(next.startsAt).ampm}
                </Text>
              </View>
              {next.assignedMember ? (
                <View style={styles.nextMetaItem}>
                  <Icon name="chair" size={16} color={m3.onSurfaceVariant} />
                  <Text style={styles.nextMeta}>{next.assignedMember.user.fullName}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.nextActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate('AppointmentEditor', { appointmentId: next.id })}
                style={[styles.nextAction, styles.nextActionPrimary]}
              >
                <Icon name="how_to_reg" size={16} color={m3.onPrimary} />
                <Text style={styles.nextActionPrimaryText}>Check in</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => navigation.navigate('AppointmentEditor', { appointmentId: next.id })}
                style={[styles.nextAction, styles.nextActionGhost]}
              >
                <Icon name="visibility" size={16} color={m3.onSurface} />
                <Text style={styles.nextActionGhostText}>Details</Text>
              </Pressable>
              {next.customerId ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('CustomerProfile', { customerId: next.customerId! })}
                  style={[styles.nextAction, styles.nextActionGhost]}
                >
                  <Icon name="chat" size={16} color={m3.onSurface} />
                  <Text style={styles.nextActionGhostText}>Client</Text>
                </Pressable>
              ) : null}
            </View>
          </M3Card>
        </View>
      ) : null}

      <View style={styles.gap8}>
        <SectionTitle
          title="Today's Schedule"
          actionLabel={`View Full (${appointments.length})`}
          onAction={() => navigation.navigate('Main', { screen: 'Calendar' })}
        />
        {rest.length ? (
          <M3Card padded={false}>
            {rest.slice(0, 3).map((a, i) => {
              const { time, ampm } = timeParts(a.startsAt);
              return (
                <Pressable
                  key={a.id}
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('AppointmentEditor', { appointmentId: a.id })}
                  style={[styles.scheduleRow, i > 0 && styles.rowDivider]}
                >
                  <View style={styles.scheduleTime}>
                    <Text style={styles.scheduleTimeText}>{time}</Text>
                    <Text style={styles.scheduleAmPm}>{ampm}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text numberOfLines={1} style={styles.scheduleName}>
                      {a.customer?.name ?? 'Walk-in'}
                    </Text>
                    <Text numberOfLines={1} style={styles.scheduleSub}>
                      {a.serviceName}
                      {a.assignedMember ? ` · ${a.assignedMember.user.fullName}` : ''}
                    </Text>
                  </View>
                  <Chip label={STATUS_TONE[a.status]?.label ?? a.status} tone={STATUS_TONE[a.status]?.tone ?? 'neutral'} />
                </Pressable>
              );
            })}
          </M3Card>
        ) : next ? null : (
          <M3Empty icon="event_available" title="No appointments today" message="Your day is clear. Tap New Booking to add one." />
        )}
      </View>

      <View style={styles.gap8}>
        <SectionTitle title="Attention Required" dot={m3.error} actionLabel={attention.length ? `${attention.length} pending` : undefined} />
        {attention.length ? (
          <View style={styles.gap10}>
            {newLeads[0] ? (
              <M3Card style={styles.attnCard}>
                <View style={styles.attnHead}>
                  <View style={[styles.attnIcon, { backgroundColor: 'rgba(0,106,97,0.12)' }]}>
                    <Icon name="chat" size={18} color={m3.secondary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.attnName}>{newLeads[0].customer?.name ?? 'New lead'}</Text>
                    <Text numberOfLines={1} style={styles.attnBody}>
                      {newLeads[0].serviceRequested ?? 'New enquiry - needs follow-up'}
                    </Text>
                  </View>
                </View>
                <View style={styles.attnActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => navigation.navigate('LeadDetail', { leadId: newLeads[0].id })}
                    style={styles.attnGhostBtn}
                  >
                    <Text style={styles.attnGhostText}>Reply</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => navigation.navigate('LeadDetail', { leadId: newLeads[0].id })}
                    style={styles.attnPrimaryBtn}
                  >
                    <Text style={styles.attnPrimaryText}>Convert to Booking</Text>
                  </Pressable>
                </View>
              </M3Card>
            ) : null}
            {pendingReviews[0] ? (
              <M3Card style={styles.attnCard}>
                <View style={styles.attnHead}>
                  <View style={[styles.attnIcon, { backgroundColor: m3.surfaceContainerHigh }]}>
                    <Icon name="star" size={18} color={m3.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.attnName}>{pendingReviews[0].customer?.name ?? 'Review opportunity'}</Text>
                    <Text numberOfLines={1} style={styles.attnBody}>
                      {pendingReviews[0].serviceName ?? 'Ask this client for a review'}
                    </Text>
                  </View>
                </View>
                <View style={styles.attnActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => navigation.navigate('ReviewDetail', { reviewId: pendingReviews[0].id })}
                    style={styles.attnGhostBtn}
                  >
                    <Text style={styles.attnGhostText}>Request review</Text>
                  </Pressable>
                </View>
              </M3Card>
            ) : null}
            {dueReminders[0] ? (
              <M3Card style={styles.attnCard}>
                <View style={styles.attnHead}>
                  <View style={[styles.attnIcon, { backgroundColor: 'rgba(171,45,25,0.10)' }]}>
                    <Icon name="event_repeat" size={18} color={m3.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.attnName}>{dueReminders[0].customer?.name ?? 'Customer due back'}</Text>
                    <Text numberOfLines={1} style={styles.attnBody}>
                      {dueReminders[0].serviceName ?? 'Time to bring this client back in'}
                    </Text>
                  </View>
                </View>
                <View style={styles.attnActions}>
                  <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Comeback')} style={styles.attnPrimaryBtn}>
                    <Text style={styles.attnPrimaryText}>Bring back</Text>
                  </Pressable>
                </View>
              </M3Card>
            ) : null}
          </View>
        ) : (
          <M3Empty icon="task_alt" title="You're all caught up" message="New leads, reviews, and comebacks land here." />
        )}
      </View>

      <View style={styles.quickGrid}>
        {quickActions.map((qa) => (
          <Pressable key={qa.label} accessibilityRole="button" onPress={qa.onPress} style={styles.quickItem}>
            <View style={[styles.quickIcon, qa.tone === 'primary' ? { backgroundColor: 'rgba(171,45,25,0.14)' } : { backgroundColor: m3.surfaceContainerHigh }]}>
              <Icon name={qa.icon} size={20} color={qa.tone === 'primary' ? m3.primary : m3.onSurface} />
            </View>
            <Text numberOfLines={1} style={styles.quickLabel}>
              {qa.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </M3Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  gap8: { gap: m3Space.xs },
  gap10: { gap: 10 },

  greetingRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm, paddingTop: m3Space.xxs },
  greeting: { ...m3Type.headlineMd, color: m3.onSurface },
  greetingMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  greetingMeta: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(134,242,228,0.4)', paddingHorizontal: 10, height: 26, borderRadius: m3Radius.full },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: m3.secondary },
  liveText: { ...m3Type.labelSm, color: m3.onSecondaryContainer, letterSpacing: 0 },

  metricStrip: { flexDirection: 'row', padding: m3Space.sm, gap: m3Space.xs },
  metric: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainerLow },
  metricDot: { position: 'absolute', top: 8, right: 10, width: 7, height: 7, borderRadius: 4, backgroundColor: m3.primary },
  metricValue: { ...m3Type.headlineSm, color: m3.onSurface },
  metricLabel: { ...m3Type.labelXs, color: m3.onSurfaceVariant, marginTop: 2, letterSpacing: 0 },

  eyebrow: { ...m3Type.labelSm, color: m3.onSurfaceVariant },
  nextHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
  nextInPill: { backgroundColor: 'rgba(255,218,211,0.55)', paddingHorizontal: 10, height: 24, borderRadius: m3Radius.full, justifyContent: 'center' },
  nextInText: { ...m3Type.labelSm, color: m3.primary, letterSpacing: 0 },
  nextCard: { overflow: 'hidden', gap: m3Space.sm },
  nextGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 4, backgroundColor: m3.primary },
  nextTopRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm, paddingTop: 4 },
  nextClientRow: { flexDirection: 'row', alignItems: 'flex-start', gap: m3Space.sm, flex: 1, minWidth: 0 },
  avatar: { width: 44, height: 44, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...m3Type.headlineSm, fontSize: 16, color: m3.primary },
  nextName: { ...m3Type.headlineSm, fontSize: 18, color: m3.onSurface },
  nextService: { ...m3Type.bodyMd, color: m3.onSurface, marginTop: 1 },
  nextPrice: { ...m3Type.labelSm, color: m3.onSurfaceVariant, marginTop: 2, letterSpacing: 0 },
  nextMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(242,243,255,0.7)', borderRadius: m3Radius.sm, paddingHorizontal: m3Space.sm, paddingVertical: 8 },
  nextMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nextMeta: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  nextMetaStrong: { ...m3Type.labelMd, color: m3.onSurface },
  nextActions: { flexDirection: 'row', gap: m3Space.xs },
  nextAction: { flex: 1, height: 38, borderRadius: m3Radius.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  nextActionPrimary: { backgroundColor: m3.primary },
  nextActionPrimaryText: { ...m3Type.labelMd, color: m3.onPrimary },
  nextActionGhost: { backgroundColor: m3.surfaceContainerHigh },
  nextActionGhostText: { ...m3Type.labelMd, color: m3.onSurface },

  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, padding: m3Space.sm },
  rowDivider: { borderTopWidth: 1, borderTopColor: m3.surfaceContainerHigh },
  scheduleTime: { width: 52, alignItems: 'center', backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.sm, paddingVertical: 6 },
  scheduleTimeText: { ...m3Type.labelSm, color: m3.onSurface, letterSpacing: 0 },
  scheduleAmPm: { ...m3Type.labelXs, fontSize: 10, color: m3.onSurfaceVariant },
  scheduleName: { ...m3Type.labelLg, color: m3.onSurface },
  scheduleSub: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },

  attnCard: { gap: 10 },
  attnHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  attnIcon: { width: 32, height: 32, borderRadius: m3Radius.sm, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  attnName: { ...m3Type.labelLg, color: m3.onSurface },
  attnBody: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  attnActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: m3Space.xs },
  attnGhostBtn: { paddingHorizontal: 14, height: 34, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  attnGhostText: { ...m3Type.labelMd, color: m3.onSurface },
  attnPrimaryBtn: { paddingHorizontal: 14, height: 34, borderRadius: m3Radius.sm, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  attnPrimaryText: { ...m3Type.labelMd, color: m3.onPrimary },

  quickGrid: { flexDirection: 'row', gap: m3Space.xs, paddingTop: 4 },
  quickItem: { flex: 1, alignItems: 'center', backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.lg, paddingVertical: 10, ...m3Shadow.card },
  quickIcon: { width: 36, height: 36, borderRadius: m3Radius.sm, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  quickLabel: { ...m3Type.labelXs, color: m3.onSurface },
});
