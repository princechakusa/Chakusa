import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppointmentDto, AppointmentStatus } from '../apiTypes';
import { endOfDay, localDateKey, startOfDay, weekDates } from '../domain/calendar';
import { appointmentsApi } from '../services/endpoints';
import { RootStackParamList } from '../types';
import { formatMoney } from '../utils/format';
import { m3, m3Radius, m3Shadow, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';

type Mode = 'day' | 'week' | 'agenda';
const STRIP_DAYS = 14;

const STATUS_EDGE: Record<AppointmentStatus, string> = {
  SCHEDULED: m3.primary,
  CONFIRMED: m3.secondary,
  COMPLETED: m3.outline,
  CANCELED: m3.error,
  NO_SHOW: m3.tertiary,
};
const ARRIVAL_LABEL: Record<'ON_MY_WAY' | 'RUNNING_LATE' | 'ARRIVED', string> = {
  ON_MY_WAY: 'On my way',
  RUNNING_LATE: 'Running late',
  ARRIVED: 'Arrived',
};
const STATUS_CHIP: Record<AppointmentStatus, { label: string; tone: 'secondary' | 'neutral' | 'error' | 'primaryFixed' }> = {
  SCHEDULED: { label: 'Confirmed', tone: 'neutral' },
  CONFIRMED: { label: 'Confirmed', tone: 'secondary' },
  COMPLETED: { label: 'Done', tone: 'neutral' },
  CANCELED: { label: 'Canceled', tone: 'error' },
  NO_SHOW: { label: 'No show', tone: 'error' },
};

function timeLabel(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function durationMin(a: AppointmentDto) {
  return Math.max(1, Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000));
}

export function CalendarScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [mode, setMode] = useState<Mode>('day');
  const [items, setItems] = useState<AppointmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const week = useMemo(() => weekDates(selected), [selected]);
  const strip = useMemo(() => {
    const first = startOfDay(week[0]);
    return Array.from({ length: STRIP_DAYS }, (_, i) => {
      const d = new Date(first);
      d.setDate(first.getDate() + i);
      return d;
    });
  }, [week]);

  const range = useMemo(() => {
    if (mode === 'day') return { from: startOfDay(selected), to: endOfDay(selected) };
    const from = mode === 'week' ? startOfDay(week[0]) : startOfDay(selected);
    const to = new Date(from);
    to.setDate(to.getDate() + (mode === 'week' ? 7 : 30));
    return { from, to };
  }, [mode, selected, week]);

  const load = useCallback(
    async (soft = false) => {
      soft ? setRefreshing(true) : setLoading(true);
      setError(null);
      try {
        setItems(await appointmentsApi.list(range.from.toISOString(), range.to.toISOString()));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Unable to load appointments.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [range],
  );

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const selectedKey = localDateKey(selected);
  const todayKey = localDateKey(new Date());
  const dayItems = useMemo(
    () =>
      items
        .filter((i) => localDateKey(new Date(i.startsAt)) === selectedKey)
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [items, selectedKey],
  );
  const grouped = useMemo(() => {
    const out: Record<string, AppointmentDto[]> = {};
    for (const i of items) (out[localDateKey(new Date(i.startsAt))] ??= []).push(i);
    return out;
  }, [items]);
  const countByKey = useMemo(() => {
    const out: Record<string, number> = {};
    for (const i of items) out[localDateKey(new Date(i.startsAt))] = (out[localDateKey(new Date(i.startsAt))] ?? 0) + 1;
    return out;
  }, [items]);

  const active = dayItems.filter((a) => a.status !== 'CANCELED');
  const booked = active.length;

  const header = (
    <M3Header
      businessName="Calendar"
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      onAvatarPress={() => navigation.navigate('Main', { screen: 'Settings' })}
      hasNotifications={false}
    />
  );

  const openAppointment = (id: string) =>
    navigation.navigate('AppointmentEditor', { appointmentId: id });

  const renderCard = (a: AppointmentDto) => {
    const chip = STATUS_CHIP[a.status];
    return (
      <View key={a.id} style={styles.timelineRow}>
        <View style={styles.gutter}>
          <Text style={styles.gutterTime}>{timeLabel(a.startsAt).replace(' ', '\n')}</Text>
          <Text style={styles.gutterDur}>{durationMin(a)}m</Text>
          <View style={styles.gutterLine} />
        </View>
        <M3Card onPress={() => openAppointment(a.id)} style={styles.apptCard}>
          <View style={[styles.edge, { backgroundColor: STATUS_EDGE[a.status] }]} />
          <View style={styles.apptTop}>
            <View style={styles.apptClientRow}>
              <View style={styles.apptAvatar}>
                <Text style={styles.apptAvatarText}>
                  {(a.customer?.name ?? 'WI')
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((p) => p[0]?.toUpperCase() ?? '')
                    .join('')}
                </Text>
              </View>
              <View style={styles.flex}>
                <Text numberOfLines={1} style={styles.apptName}>
                  {a.customer?.name ?? 'Walk-in'}
                </Text>
                <Text numberOfLines={1} style={styles.apptService}>
                  {a.serviceName}
                </Text>
              </View>
            </View>
            <Chip label={chip.label} tone={chip.tone} />
          </View>
          <View style={styles.apptMetaRow}>
            {a.assignedMember ? (
              <View style={styles.apptMetaItem}>
                <Icon name="chair" size={15} color={m3.onSurfaceVariant} />
                <Text style={styles.apptMeta}>{a.assignedMember.user.fullName}</Text>
              </View>
            ) : (
              <View style={styles.apptMetaItem}>
                <Icon name="schedule" size={15} color={m3.onSurfaceVariant} />
                <Text style={styles.apptMeta}>Until {timeLabel(a.endsAt)}</Text>
              </View>
            )}
            {a.price != null ? (
              <View style={styles.apptMetaItem}>
                <Icon name="local_atm" size={15} color={m3.primary} />
                <Text style={styles.apptPrice}>{formatMoney(a.price)}</Text>
              </View>
            ) : null}
            {a.arrivalState ? (
              <View style={styles.apptMetaItem}>
                <Icon name="near_me" size={15} color={m3.secondary} />
                <Text style={styles.apptMeta}>{ARRIVAL_LABEL[a.arrivalState]}</Text>
              </View>
            ) : null}
          </View>
        </M3Card>
      </View>
    );
  };

  return (
    <M3Screen
      header={header}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={m3.primary} />}
    >
      <View style={styles.subheadRow}>
        <View style={styles.flex}>
          <View style={styles.subheadTitleRow}>
            <Text style={styles.subheadTitle}>
              {selected.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </Text>
            {selectedKey === todayKey ? (
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Live</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.subheadDate}>
            {selected.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </Text>
        </View>
        <View style={styles.subheadActions}>
          {selectedKey !== todayKey ? (
            <Pressable accessibilityRole="button" onPress={() => setSelected(startOfDay(new Date()))} style={styles.todayBtn}>
              <Icon name="today" size={16} color={m3.secondary} />
              <Text style={styles.todayText}>Today</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Availability"
            onPress={() => navigation.navigate('AvailabilitySettings')}
            style={styles.iconBtn}
          >
            <Icon name="tune" size={18} color={m3.onSurface} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New appointment"
            onPress={() => navigation.navigate('AppointmentEditor', { date: selectedKey })}
            style={styles.bookBtn}
          >
            <Icon name="add" size={18} color={m3.onPrimary} />
            <Text style={styles.bookText}>Book</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.segment}>
        {(['day', 'week', 'agenda'] as const).map((m) => (
          <Pressable
            key={m}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
            onPress={() => setMode(m)}
            style={[styles.segmentItem, mode === m && styles.segmentItemActive]}
          >
            <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
              {m === 'agenda' ? 'Agenda' : m[0].toUpperCase() + m.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {strip.map((d) => {
          const key = localDateKey(d);
          const isSel = key === selectedKey;
          const isToday = key === todayKey;
          const n = countByKey[key] ?? 0;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: isSel }}
              onPress={() => setSelected(startOfDay(d))}
              style={[styles.stripDay, isSel && styles.stripDayActive, !isSel && isToday && styles.stripDayToday]}
            >
              <Text style={[styles.stripWeekday, isSel && styles.stripTextActive]}>
                {d.toLocaleDateString(undefined, { weekday: 'short' })}
              </Text>
              <Text style={[styles.stripNum, isSel && styles.stripTextActive]}>{d.getDate()}</Text>
              <View style={[styles.stripDot, n > 0 && styles.stripDotOn, isSel && n > 0 && styles.stripDotActive]} />
            </Pressable>
          );
        })}
      </ScrollView>

      {mode === 'day' && !loading && !error && active.length ? (
        <M3Card style={styles.capacityCard}>
          <View style={styles.capacityIcon}>
            <Icon name="analytics" size={20} color={m3.primary} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.capacityTitle}>{booked} booked today</Text>
            <Text style={styles.capacitySub}>
              {active.filter((a) => a.status === 'CONFIRMED').length} confirmed ·{' '}
              {active.filter((a) => a.status === 'SCHEDULED').length} pending
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Main', { screen: 'Reviews' })} style={styles.rosterBtn}>
            <Text style={styles.rosterText}>Roster</Text>
            <Icon name="chevron_right" size={15} color={m3.onSurface} />
          </Pressable>
        </M3Card>
      ) : null}

      {loading && !items.length ? (
        <M3Loading label="Loading appointments…" />
      ) : error ? (
        <M3Error message={error} onRetry={() => void load()} />
      ) : mode === 'day' ? (
        dayItems.length ? (
          <View>{dayItems.map(renderCard)}</View>
        ) : (
          <M3Empty icon="event_available" title="Nothing booked" message="This day is clear. Tap Book to add an appointment." />
        )
      ) : Object.keys(grouped).length ? (
        <View style={styles.gap16}>
          {Object.entries(grouped)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, entries]) => (
              <View key={key} style={styles.gap8}>
                <Text style={styles.dayHeading}>
                  {new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                  })}
                </Text>
                {entries.slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt)).map(renderCard)}
              </View>
            ))}
        </View>
      ) : (
        <M3Empty
          icon="event_available"
          title="No appointments"
          message={mode === 'week' ? 'Your week is clear.' : 'Your next 30 days are clear.'}
        />
      )}

      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ExternalCalendar')} style={styles.syncRow}>
        <Icon name="sync" size={15} color={m3.onSurfaceVariant} />
        <Text style={styles.syncText}>Sync to Google, Apple, or Outlook Calendar</Text>
        <Icon name="chevron_right" size={15} color={m3.outline} />
      </Pressable>
    </M3Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  gap8: { gap: m3Space.xs },
  gap16: { gap: m3Space.md },

  subheadRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm },
  subheadTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subheadTitle: { ...m3Type.headlineSm, color: m3.onSurface },
  subheadDate: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: m3.secondaryContainer, paddingHorizontal: 8, height: 20, borderRadius: m3Radius.full },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: m3.secondary },
  liveText: { ...m3Type.labelXs, color: m3.onSecondaryContainer, letterSpacing: 0 },
  subheadActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  todayBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: 10, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainer },
  todayText: { ...m3Type.labelMd, color: m3.onSurface },
  iconBtn: { width: 34, height: 34, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  bookBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 34, paddingHorizontal: 12, borderRadius: m3Radius.sm, backgroundColor: m3.primary },
  bookText: { ...m3Type.labelMd, color: m3.onPrimary },

  segment: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainerLow },
  segmentItem: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: m3Radius.sm },
  segmentItemActive: { backgroundColor: m3.surfaceContainerLowest, ...m3Shadow.card },
  segmentText: { ...m3Type.labelMd, color: m3.onSurfaceVariant },
  segmentTextActive: { color: m3.primary },

  strip: { gap: 6, paddingVertical: 2 },
  stripDay: { width: 48, paddingVertical: 8, borderRadius: m3Radius.md, alignItems: 'center', gap: 3, backgroundColor: m3.surfaceContainerLowest, ...m3Shadow.card },
  stripDayActive: { backgroundColor: m3.primary },
  stripDayToday: { borderWidth: 1, borderColor: m3.primary },
  stripWeekday: { ...m3Type.labelXs, color: m3.onSurfaceVariant, textTransform: 'uppercase' },
  stripNum: { ...m3Type.headlineSm, fontSize: 17, color: m3.onSurface },
  stripTextActive: { color: m3.onPrimary },
  stripDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'transparent' },
  stripDotOn: { backgroundColor: m3.primary },
  stripDotActive: { backgroundColor: m3.onPrimary },

  capacityCard: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  capacityIcon: { width: 40, height: 40, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainerHighest, alignItems: 'center', justifyContent: 'center' },
  capacityTitle: { ...m3Type.labelLg, color: m3.onSurface },
  capacitySub: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  rosterBtn: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 32, paddingHorizontal: 10, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainerLowest, ...m3Shadow.card },
  rosterText: { ...m3Type.labelSm, color: m3.onSurface, letterSpacing: 0 },

  timelineRow: { flexDirection: 'row', gap: m3Space.sm, marginBottom: m3Space.sm },
  gutter: { width: 52, alignItems: 'center', paddingTop: 4 },
  gutterTime: { ...m3Type.labelSm, color: m3.onSurface, textAlign: 'center', letterSpacing: 0 },
  gutterDur: { ...m3Type.labelXs, fontSize: 10, color: m3.onSurfaceVariant, marginTop: 2 },
  gutterLine: { width: 2, flex: 1, marginTop: 8, borderRadius: 1, backgroundColor: m3.surfaceContainerHighest },

  apptCard: { flex: 1, overflow: 'hidden', gap: 10 },
  edge: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5 },
  apptTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.xs, paddingLeft: 6 },
  apptClientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  apptAvatar: { width: 36, height: 36, borderRadius: m3Radius.full, backgroundColor: m3.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  apptAvatarText: { ...m3Type.labelMd, color: m3.onPrimaryFixedVariant },
  apptName: { ...m3Type.headlineSm, fontSize: 16, color: m3.onSurface },
  apptService: { ...m3Type.labelSm, color: m3.onSurfaceVariant, marginTop: 1, letterSpacing: 0 },
  apptMetaRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.md, paddingLeft: 6 },
  apptMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  apptMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  apptPrice: { ...m3Type.labelMd, color: m3.onSurface },

  dayHeading: { ...m3Type.titleMd, color: m3.onSurface },

  syncRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.xs, paddingVertical: m3Space.sm, borderTopWidth: 1, borderTopColor: m3.surfaceContainerHigh },
  syncText: { ...m3Type.bodySm, color: m3.onSurfaceVariant, flex: 1 },
});
