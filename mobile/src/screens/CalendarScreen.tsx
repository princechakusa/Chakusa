import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppointmentDto, AppointmentStatus } from '../apiTypes';
import { AppHeader, EmptyState, ErrorState, IconButton, LoadingState, Screen, StatusBadge } from '../components/ui';
import { endOfDay, layoutDayGrid, localDateKey, minutesOfDay, startOfDay, weekDates } from '../domain/calendar';
import { appointmentsApi } from '../services/endpoints';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatMoney } from '../utils/format';

type Mode = 'day' | 'week' | 'agenda';
const HOUR_HEIGHT = 62;
const GRID_START_HOUR = 0;
const GRID_END_HOUR = 24;
const STRIP_DAYS = 14;

const STATUS_ACCENT: Record<AppointmentStatus, string> = {
  SCHEDULED: colors.primary,
  CONFIRMED: colors.success,
  COMPLETED: colors.tabInactive,
  CANCELED: colors.negative,
  NO_SHOW: colors.attention,
};

function statusLabel(status: AppointmentStatus) {
  return status === 'NO_SHOW' ? 'No show' : status[0] + status.slice(1).toLowerCase();
}

export function CalendarScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [selected, setSelected] = useState(() => startOfDay(new Date()));
  const [mode, setMode] = useState<Mode>('day');
  const [items, setItems] = useState<AppointmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const gridRef = useRef<ScrollView>(null);

  const week = useMemo(() => weekDates(selected), [selected]);
  const strip = useMemo(() => {
    const first = startOfDay(week[0]);
    return Array.from({ length: STRIP_DAYS }, (_, index) => {
      const date = new Date(first);
      date.setDate(first.getDate() + index);
      return date;
    });
  }, [week]);

  const range = useMemo(() => {
    if (mode === 'day') return { from: startOfDay(selected), to: endOfDay(selected) };
    const from = mode === 'week' ? startOfDay(week[0]) : startOfDay(selected);
    const to = new Date(from);
    to.setDate(to.getDate() + (mode === 'week' ? 7 : 30));
    return { from, to };
  }, [mode, selected, week]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await appointmentsApi.list(range.from.toISOString(), range.to.toISOString()));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load appointments.');
    } finally {
      setLoading(false);
    }
  }, [range]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const selectedKey = localDateKey(selected);
  const dayItems = useMemo(
    () => items
      .filter(item => localDateKey(new Date(item.startsAt)) === selectedKey)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    [items, selectedKey],
  );
  const blocks = useMemo(
    () => layoutDayGrid(dayItems, item => new Date(item.startsAt), item => new Date(item.endsAt)),
    [dayItems],
  );
  const grouped = useMemo(
    () => items.reduce<Record<string, AppointmentDto[]>>((result, item) => {
      const key = localDateKey(new Date(item.startsAt));
      (result[key] ??= []).push(item);
      return result;
    }, {}),
    [items],
  );

  const isToday = selectedKey === localDateKey(now);
  const nowMinutes = minutesOfDay(now);

  useEffect(() => {
    if (mode !== 'day') return;
    const earliest = dayItems.length ? minutesOfDay(new Date(dayItems[0].startsAt)) : (isToday ? nowMinutes : 8 * 60);
    const target = Math.max(0, (earliest - 40) / 60 * HOUR_HEIGHT);
    const handle = setTimeout(() => gridRef.current?.scrollTo({ y: target, animated: false }), 60);
    return () => clearTimeout(handle);
  }, [mode, selectedKey, dayItems, isToday, nowMinutes]);

  const openAppointment = (id: string) => navigation.navigate('AppointmentEditor', { appointmentId: id });

  const monthTitle = selected.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const subtitle = selected.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <Screen scroll={false} style={styles.screen}>
      <AppHeader
        eyebrow="SCHEDULE"
        title={monthTitle}
        subtitle={subtitle}
        right={
          <View style={styles.headerActions}>
            {!isToday ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setSelected(startOfDay(new Date()))}
                style={styles.todayChip}
              >
                <Text style={styles.todayChipText}>Today</Text>
              </Pressable>
            ) : null}
            <IconButton icon="options-outline" label="Booking availability" onPress={() => navigation.navigate('AvailabilitySettings')} />
            <IconButton icon="add" label="Create appointment" onPress={() => navigation.navigate('AppointmentEditor', { date: selectedKey })} />
          </View>
        }
      />

      <View style={styles.modes}>
        {(['day', 'week', 'agenda'] as const).map(item => (
          <Pressable
            key={item}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === item }}
            onPress={() => setMode(item)}
            style={[styles.mode, mode === item && styles.modeActive]}
          >
            <Text style={[styles.modeText, mode === item && styles.modeTextActive]}>
              {item === 'agenda' ? 'Agenda' : item[0].toUpperCase() + item.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        style={styles.stripWrap}
      >
        {strip.map(date => {
          const key = localDateKey(date);
          const active = key === selectedKey;
          const today = key === localDateKey(now);
          const count = grouped[key]?.length ?? 0;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => setSelected(startOfDay(date))}
              style={[styles.stripDay, active && styles.stripDayActive, !active && today && styles.stripDayToday]}
            >
              <Text style={[styles.stripWeekday, active && styles.stripTextActive]}>
                {date.toLocaleDateString(undefined, { weekday: 'short' })}
              </Text>
              <Text style={[styles.stripNumber, active && styles.stripTextActive]}>{date.getDate()}</Text>
              <View style={[styles.stripDot, count > 0 && styles.stripDotOn, active && count > 0 && styles.stripDotActive]} />
            </Pressable>
          );
        })}
      </ScrollView>

      {loading && !items.length ? (
        <LoadingState label="Loading appointments…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : mode === 'day' ? (
        dayItems.length ? (
          <ScrollView
            ref={gridRef}
            style={styles.gridWrap}
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
          >
            <View style={{ height: (GRID_END_HOUR - GRID_START_HOUR) * HOUR_HEIGHT }}>
              {Array.from({ length: GRID_END_HOUR - GRID_START_HOUR + 1 }, (_, index) => {
                const hour = GRID_START_HOUR + index;
                return (
                  <View key={hour} style={[styles.hourRow, { top: index * HOUR_HEIGHT }]}>
                    <Text style={styles.hourLabel}>
                      {hour === 0 || hour === 24 ? '12 AM' : hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`}
                    </Text>
                    <View style={styles.hourLine} />
                  </View>
                );
              })}

              {isToday ? (
                <View style={[styles.nowLine, { top: nowMinutes / 60 * HOUR_HEIGHT }]} pointerEvents="none">
                  <View style={styles.nowDot} />
                  <View style={styles.nowRule} />
                </View>
              ) : null}

              {blocks.map(({ item, startMinute, endMinute, lane, lanes }) => {
                const accent = STATUS_ACCENT[item.status];
                const laneWidthPct = 100 / lanes;
                const canceled = item.status === 'CANCELED';
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() => openAppointment(item.id)}
                    style={({ pressed }) => [
                      styles.block,
                      {
                        top: startMinute / 60 * HOUR_HEIGHT + 2,
                        height: (endMinute - startMinute) / 60 * HOUR_HEIGHT - 4,
                        left: `${lane * laneWidthPct}%`,
                        width: `${laneWidthPct}%`,
                        borderLeftColor: accent,
                        backgroundColor: pressed ? colors.primarySoft : colors.surface,
                      },
                    ]}
                  >
                    <Text numberOfLines={1} style={[styles.blockTitle, canceled && styles.blockTitleCanceled]}>
                      {item.serviceName}
                    </Text>
                    <Text numberOfLines={1} style={styles.blockMeta}>
                      {new Date(item.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      {' · '}
                      {item.customer?.name ?? 'Walk-in'}
                    </Text>
                    {endMinute - startMinute >= 55 && item.price != null ? (
                      <Text style={styles.blockPrice}>{formatMoney(item.price)}</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
        ) : (
          <EmptyState
            icon="calendar-outline"
            title="Nothing booked"
            message="This day is clear. Tap + to add an appointment."
          />
        )
      ) : (
        <ScrollView style={styles.gridWrap} contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {Object.keys(grouped).length ? (
            Object.entries(grouped)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, entries]) => (
                <View key={key} style={styles.dayGroup}>
                  <Text style={styles.dateHeading}>
                    {new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
                  </Text>
                  {entries
                    .slice()
                    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                    .map(item => (
                      <AgendaRow key={item.id} item={item} onPress={() => openAppointment(item.id)} />
                    ))}
                </View>
              ))
          ) : (
            <EmptyState
              icon="calendar-outline"
              title="No appointments"
              message={mode === 'week' ? 'Your week is clear.' : 'Your next 30 days are clear.'}
            />
          )}
        </ScrollView>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('ExternalCalendar')}
        style={styles.syncRow}
      >
        <Ionicons name="sync-outline" size={15} color={colors.textSecondary} />
        <Text style={styles.syncText}>Sync to Google, Apple, or Outlook Calendar</Text>
        <Ionicons name="chevron-forward" size={15} color={colors.tabInactive} />
      </Pressable>
    </Screen>
  );
}

function AgendaRow({ item, onPress }: { item: AppointmentDto; onPress: () => void }) {
  const start = new Date(item.startsAt);
  const end = new Date(item.endsAt);
  const accent = STATUS_ACCENT[item.status];
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.cardTime}>
        <Text style={styles.cardTimeText}>{start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text>
        <Text style={styles.cardEndText}>{end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</Text>
      </View>
      <View style={[styles.cardRail, { backgroundColor: accent }]} />
      <View style={styles.cardBody}>
        <Text style={styles.cardService}>{item.serviceName}</Text>
        <Text style={styles.cardMeta}>
          {item.customer?.name ?? 'Walk-in customer'}
          {item.assignedMember ? ` · ${item.assignedMember.user.fullName}` : ''}
        </Text>
        {item.price != null ? <Text style={styles.cardPrice}>{formatMoney(item.price)}</Text> : null}
      </View>
      <StatusBadge label={statusLabel(item.status)} />
      <Ionicons name="chevron-forward" size={17} color={colors.tabInactive} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { gap: spacing.sm, paddingBottom: 0 },
  headerActions: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center' },
  todayChip: { paddingHorizontal: spacing.sm, height: 34, borderRadius: radius.round, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  todayChipText: { ...typography.caption, color: colors.text },

  modes: { flexDirection: 'row', gap: spacing.xxs, backgroundColor: colors.primarySoft, borderRadius: radius.round, padding: 4, borderWidth: 1, borderColor: colors.border },
  mode: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: radius.round },
  modeActive: { backgroundColor: colors.surface, ...shadows.card },
  modeText: { ...typography.caption, color: colors.textSecondary },
  modeTextActive: { color: colors.text },

  stripWrap: { flexGrow: 0 },
  strip: { gap: spacing.xs, paddingVertical: spacing.xxs },
  stripDay: { width: 52, paddingVertical: spacing.xs, borderRadius: radius.lg, alignItems: 'center', gap: 3, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  stripDayActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  stripDayToday: { borderColor: colors.primary },
  stripWeekday: { ...typography.micro, color: colors.textSecondary, fontWeight: '700' },
  stripNumber: { ...typography.bodyStrong, color: colors.text },
  stripTextActive: { color: colors.surface },
  stripDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'transparent' },
  stripDotOn: { backgroundColor: colors.primary },
  stripDotActive: { backgroundColor: colors.surface },

  gridWrap: { flex: 1 },
  grid: { paddingTop: spacing.xs, paddingBottom: spacing.xxl },
  hourRow: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'flex-start', height: HOUR_HEIGHT },
  hourLabel: { width: 54, ...typography.micro, color: colors.tabInactive, fontWeight: '700', marginTop: -6, textAlign: 'right', paddingRight: spacing.xs },
  hourLine: { flex: 1, height: 1, backgroundColor: colors.divider, marginTop: 0 },

  nowLine: { position: 'absolute', left: 46, right: 0, flexDirection: 'row', alignItems: 'center' },
  nowDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.primary },
  nowRule: { flex: 1, height: 2, backgroundColor: colors.primary },

  block: { position: 'absolute', marginLeft: 58, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, borderLeftWidth: 3, paddingHorizontal: spacing.xs, paddingVertical: 5, overflow: 'hidden', ...shadows.card },
  blockTitle: { ...typography.caption, color: colors.text, fontWeight: '700' },
  blockTitleCanceled: { textDecorationLine: 'line-through', color: colors.textSecondary },
  blockMeta: { ...typography.micro, color: colors.textSecondary, fontWeight: '500', marginTop: 1 },
  blockPrice: { ...typography.micro, color: colors.success, fontWeight: '700', marginTop: 2 },

  list: { gap: spacing.sm, paddingTop: spacing.xs, paddingBottom: spacing.xxl },
  dayGroup: { gap: spacing.xs },
  dateHeading: { ...typography.bodyStrong, color: colors.text, marginTop: spacing.xs },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  pressed: { opacity: 0.75 },
  cardTime: { width: 68 },
  cardTimeText: { ...typography.bodyStrong, color: colors.text },
  cardEndText: { ...typography.micro, color: colors.textSecondary, fontWeight: '500' },
  cardRail: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  cardBody: { flex: 1 },
  cardService: { ...typography.bodyStrong, color: colors.text },
  cardMeta: { ...typography.caption, color: colors.textSecondary },
  cardPrice: { ...typography.caption, color: colors.success },

  syncRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  syncText: { ...typography.caption, color: colors.textSecondary, flex: 1 },
});
