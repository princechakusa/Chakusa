import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppHeader, Divider, ErrorState, InfoRow, LoadingState, PrimaryButton, Screen, SecondaryButton } from '../../components/ui';
import type { BookingAvailabilityDto, CustomerBookingDto } from '../../apiTypes';
import { bookingActions, bookingStatusLabel, formatSlotTime, groupSlotsByDay, reminderStatusLabel } from '../../domain/booking';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDateTime, formatMoney } from '../../utils/format';
import { bookingApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'BookingDetail'>;

// PROGRAM 2 LOOP 7: one booking + its management. `/customer/bookings/:id`
// for the detail; reschedule and cancel call the matching server routes,
// which own the actual eligibility rules — `domain/booking.ts` only mirrors
// them to decide what to show.

export function BookingDetailScreen({ route, navigation }: Props) {
  const { bookingId } = route.params;
  const [booking, setBooking] = useState<CustomerBookingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [availability, setAvailability] = useState<BookingAvailabilityDto | null>(null);

  const load = useCallback(async () => {
    try { setBooking(await bookingApi.get(bookingId)); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load this booking.'); }
    finally { setLoaded(true); }
  }, [bookingId]);

  useEffect(() => { void load(); }, [load]);

  const actions = booking ? bookingActions(booking) : { canReschedule: false, canCancel: false, reason: null };
  const timezone = availability?.timezone ?? booking?.business.timezone ?? 'UTC';
  const dayGroups = useMemo(
    () => availability ? groupSlotsByDay(availability.slots, timezone) : [],
    [availability, timezone],
  );

  const beginReschedule = async () => {
    if (!booking || !booking.serviceId || !booking.business.slug) {
      Alert.alert('Reschedule unavailable', 'This booking can’t be rescheduled in the app. Please contact the business.');
      return;
    }
    setBusy(true);
    try {
      const from = new Date();
      const to = new Date(from.getTime() + 21 * 86_400_000);
      setAvailability(await bookingApi.availability(booking.business.slug, booking.serviceId, from.toISOString(), to.toISOString()));
      setRescheduling(true);
    } catch (caught) {
      Alert.alert('Could not load times', caught instanceof ApiError ? caught.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const confirmReschedule = async (startsAt: string) => {
    if (!booking) return;
    setBusy(true);
    try {
      setBooking(await bookingApi.reschedule(booking.id, startsAt));
      setRescheduling(false);
    } catch (caught) {
      Alert.alert('Could not reschedule', caught instanceof ApiError ? caught.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!booking) return;
    Alert.alert('Cancel this booking?', 'The business will be notified.', [
      { text: 'Keep booking', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try { setBooking(await bookingApi.cancel(booking.id)); }
          catch (caught) { Alert.alert('Could not cancel', caught instanceof ApiError ? caught.message : 'Please try again.'); }
          finally { setBusy(false); }
        },
      },
    ]);
  };

  if (!loaded) return <Screen><LoadingState label="Loading…" /></Screen>;
  if (error || !booking) return <Screen><ErrorState message={error ?? 'Not found.'} onRetry={load} /></Screen>;

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow={bookingStatusLabel(booking.status).toUpperCase()} title={booking.serviceName} subtitle={booking.business.name} />

      <View style={styles.card}>
        <InfoRow icon="calendar-outline" label="When" value={formatDateTime(booking.startsAt)} />
        <Divider />
        <InfoRow icon="time-outline" label="Ends" value={formatDateTime(booking.endsAt)} />
        {booking.staffName ? <><Divider /><InfoRow icon="person-outline" label="With" value={booking.staffName} /></> : null}
        {booking.price != null ? <><Divider /><InfoRow icon="pricetag-outline" label="Price" value={formatMoney(booking.price, booking.business.currency ?? 'USD')} /></> : null}
        <Divider />
        <InfoRow icon="notifications-outline" label="Reminder" value={reminderStatusLabel(booking.reminder)} />
        {booking.business.phone ? <><Divider /><InfoRow icon="call-outline" label="Business" value={booking.business.phone} /></> : null}
      </View>

      {booking.notes ? <Text style={styles.notes}>“{booking.notes}”</Text> : null}

      {rescheduling ? (
        <View style={styles.reschedule}>
          <Text style={styles.groupLabel}>Pick a new time</Text>
          {dayGroups.length === 0 ? <Text style={styles.dim}>No open times in the next 21 days.</Text> : null}
          {dayGroups.map((group) => (
            <View key={group.day} style={styles.dayBlock}>
              <Text style={styles.dayLabel}>
                {new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: timezone }).format(new Date(group.slots[0].startsAt))}
              </Text>
              <View style={styles.chips}>
                {group.slots.map((slot) => (
                  <Pressable key={slot.startsAt} accessibilityRole="button" disabled={busy} onPress={() => void confirmReschedule(slot.startsAt)} style={styles.chip}>
                    <Text style={styles.chipText}>{formatSlotTime(slot.startsAt, timezone)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          <SecondaryButton fullWidth label="Keep current time" onPress={() => setRescheduling(false)} />
        </View>
      ) : (
        <View style={styles.actions}>
          {actions.canReschedule ? <SecondaryButton fullWidth icon="swap-horizontal" label={busy ? 'Please wait…' : 'Reschedule'} disabled={busy} onPress={() => void beginReschedule()} /> : null}
          {actions.canCancel ? <PrimaryButton fullWidth icon="close" label="Cancel booking" disabled={busy} onPress={cancel} /> : null}
          {!actions.canReschedule && !actions.canCancel ? (
            <View style={styles.closedRow}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.dim}>{actions.reason ?? 'No changes can be made to this booking.'}</Text>
            </View>
          ) : null}
          <SecondaryButton fullWidth label="Back to bookings" onPress={() => navigation.goBack()} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  notes: { ...typography.body, color: colors.textSecondary, fontStyle: 'italic' },
  actions: { gap: spacing.sm },
  closedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  dim: { ...typography.caption, color: colors.textSecondary },
  reschedule: { gap: spacing.sm },
  groupLabel: { ...typography.caption, color: colors.textSecondary },
  dayBlock: { gap: spacing.xs },
  dayLabel: { ...typography.bodyStrong, color: colors.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { minHeight: 38, paddingHorizontal: spacing.md, justifyContent: 'center', borderRadius: radius.round, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipText: { ...typography.caption, color: colors.text },
});
