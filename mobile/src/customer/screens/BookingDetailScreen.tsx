import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { LeafletMap } from '../../components/map/LeafletMap';
import { directionsUrl } from '../../domain/places';
import { ErrorState, LoadingState, Screen } from '../../components/ui';
import type { BookingAvailabilityDto, CustomerBookingDto } from '../../apiTypes';
import { bookingActions, bookingStatusLabel, formatSlotTime, groupSlotsByDay, reminderStatusLabel } from '../../domain/booking';
import { ApiError } from '../../services/api';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { formatDateTime, formatMoney } from '../../utils/format';
import { bookingApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'BookingDetail'>;

// PROGRAM 2 LOOP 7: one booking + its management. `/customer/bookings/:id`
// for the detail; reschedule and cancel call the matching server routes,
// which own the actual eligibility rules - `domain/booking.ts` only mirrors
// them to decide what to show.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={authColors.coral} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function PrimaryBtn({ label, icon, disabled, onPress }: { label: string; icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryBtn, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      {icon ? <Ionicons name={icon} size={17} color={authColors.onCoral} /> : null}
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryBtn({ label, icon, disabled, onPress }: { label: string; icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.secondaryBtn, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      {icon ? <Ionicons name={icon} size={17} color={authColors.ink} /> : null}
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

interface SelectOption { key: string; label: string; }

// A single tap target that opens a bottom-sheet list, instead of dumping
// every open slot as wrapping pills - the same fix applied to the booking
// wizard's own Date/Time pickers.
function SelectField({ placeholder, value, options, disabled, onSelect }: { placeholder: string; value: string | null; options: SelectOption[]; disabled?: boolean; onSelect: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.key === value) ?? null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selected ? selected.label : placeholder}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.select, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
      >
        <Text style={[styles.selectText, !selected && styles.selectPlaceholder]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={authColors.inkSoft} />
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.sheetOverlay} onPress={() => setOpen(false)}>
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>{placeholder}</Text>
            <ScrollView style={styles.sheetList}>
              {options.map((option) => {
                const isActive = option.key === value;
                return (
                  <Pressable
                    key={option.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    onPress={() => { onSelect(option.key); setOpen(false); }}
                    style={({ pressed }) => [styles.sheetRow, pressed && styles.pressed]}
                  >
                    <Text style={[styles.sheetRowText, isActive && styles.sheetRowTextActive]}>{option.label}</Text>
                    {isActive ? <Ionicons name="checkmark" size={18} color={authColors.coral} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

export function BookingDetailScreen({ route, navigation }: Props) {
  const { bookingId } = route.params;
  const [booking, setBooking] = useState<CustomerBookingDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<string | null>(null);
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
  const rescheduleDaySlots = useMemo(
    () => dayGroups.find((g) => g.day === rescheduleDate)?.slots ?? [],
    [dayGroups, rescheduleDate],
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
      setRescheduleDate(null);
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

  if (!loaded) return <Screen backgroundColor={authColors.bg}><LoadingState label="Loading…" /></Screen>;
  if (error || !booking) return <Screen backgroundColor={authColors.bg}><ErrorState message={error ?? 'Not found.'} onRetry={load} /></Screen>;

  return (
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{bookingStatusLabel(booking.status).toUpperCase()}</Text>
        <Text style={styles.title}>{booking.serviceName}</Text>
        <Text style={styles.subtitle}>{booking.business.name}</Text>
      </View>

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

      <ProviderLocationCard bookingId={booking.id} active={booking.status === 'SCHEDULED' || booking.status === 'CONFIRMED'} />

      {booking.notes ? <Text style={styles.notes}>“{booking.notes}”</Text> : null}

      {rescheduling ? (
        <View style={styles.reschedule}>
          <Text style={styles.groupLabel}>Pick a new time</Text>
          {dayGroups.length === 0 ? <Text style={styles.dim}>No open times in the next 21 days.</Text> : (
            <>
              <SelectField
                placeholder="Choose a date"
                value={rescheduleDate}
                options={dayGroups.map((group) => ({
                  key: group.day,
                  label: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone }).format(new Date(group.slots[0].startsAt)),
                }))}
                onSelect={setRescheduleDate}
              />
              {rescheduleDate ? (
                <SelectField
                  placeholder="Choose a time"
                  value={null}
                  disabled={busy}
                  options={rescheduleDaySlots.map((slot) => ({ key: slot.startsAt, label: formatSlotTime(slot.startsAt, timezone) }))}
                  onSelect={(startsAt) => void confirmReschedule(startsAt)}
                />
              ) : null}
            </>
          )}
          <SecondaryBtn label="Keep current time" onPress={() => setRescheduling(false)} />
        </View>
      ) : (
        <View style={styles.actions}>
          {actions.canReschedule ? <SecondaryBtn icon="swap-horizontal" label={busy ? 'Please wait…' : 'Reschedule'} disabled={busy} onPress={() => void beginReschedule()} /> : null}
          {actions.canCancel ? <PrimaryBtn icon="close" label="Cancel booking" disabled={busy} onPress={cancel} /> : null}
          {!actions.canReschedule && !actions.canCancel ? (
            <View style={styles.closedRow}>
              <Ionicons name="information-circle-outline" size={16} color={authColors.inkSoft} />
              <Text style={styles.dim}>{actions.reason ?? 'No changes can be made to this booking.'}</Text>
            </View>
          ) : null}
          <SecondaryBtn label="Back to bookings" onPress={() => navigation.goBack()} />
        </View>
      )}
    </Screen>
  );
}

// Live Location #14 (customer side). Polls the appointment-scoped endpoint
// while the booking is active; renders only when the provider is actively
// sharing, and disappears the instant the server says sharing has ended.
function ProviderLocationCard({ bookingId, active }: { bookingId: string; active: boolean }) {
  const [share, setShare] = useState<{ latitude: number; longitude: number; updatedAt: string } | null>(null);

  useEffect(() => {
    if (!active) { setShare(null); return; }
    let alive = true;
    const poll = async () => {
      try {
        const res = await bookingApi.providerLocation(bookingId);
        if (alive) setShare(res.sharing ? { latitude: res.latitude, longitude: res.longitude, updatedAt: res.updatedAt } : null);
      } catch { if (alive) setShare(null); }
    };
    void poll();
    const t = setInterval(() => void poll(), 15_000);
    return () => { alive = false; clearInterval(t); };
  }, [bookingId, active]);

  if (!share) return null;
  const agoSec = Math.max(0, Math.round((Date.now() - new Date(share.updatedAt).getTime()) / 1000));
  return (
    <View style={styles.locCard}>
      <View style={styles.locRow}>
        <View style={styles.locDot} />
        <Text style={styles.locTitle}>Your provider is on the way</Text>
      </View>
      <Text style={styles.dim}>Sharing their live location · updated {agoSec < 60 ? `${agoSec}s` : `${Math.round(agoSec / 60)}m`} ago</Text>
      <LeafletMap height={180} center={share} zoom={15} markers={[{ ...share, kind: 'you', label: 'Your provider' }]} accessibilityLabel="Where your provider is now" />
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(directionsUrl(share.latitude, share.longitude))} style={styles.locBtn}>
        <Ionicons name="navigate-outline" size={16} color={authColors.coral} />
        <Text style={styles.locBtnText}>Open in OpenStreetMap</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  card: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, paddingHorizontal: authSpace.md, ...authShadow.card },
  infoRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: authSpace.sm },
  infoLabel: { ...authType.body, fontSize: 13, flex: 1 },
  infoValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: authColors.ink, textAlign: 'right', maxWidth: '58%' },
  divider: { height: 1, backgroundColor: authColors.lineSoft },
  locCard: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, padding: authSpace.md, gap: authSpace.xs, ...authShadow.card },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm },
  locDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: authColors.positive },
  locTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  locBtn: { flexDirection: 'row', alignItems: 'center', gap: authSpace.xs, marginTop: authSpace.xs },
  locBtnText: { ...authType.link },
  notes: { ...authType.body, fontStyle: 'italic' },
  actions: { gap: authSpace.sm },
  closedRow: { flexDirection: 'row', alignItems: 'center', gap: authSpace.xs },
  dim: { ...authType.body, fontSize: 12 },
  reschedule: { gap: authSpace.sm },
  groupLabel: { ...authType.body, fontSize: 12 },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: authSpace.md, borderRadius: authRadius.md, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface },
  selectText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: authColors.ink, flex: 1 },
  selectPlaceholder: { color: authColors.inkFaint, fontFamily: 'Inter_400Regular' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(14,17,22,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '70%', backgroundColor: authColors.surface, borderTopLeftRadius: authRadius.xl, borderTopRightRadius: authRadius.xl, padding: authSpace.lg },
  sheetTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: authColors.ink, marginBottom: authSpace.xs },
  sheetList: { flexGrow: 0 },
  sheetRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: authColors.lineSoft },
  sheetRowText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: authColors.ink },
  sheetRowTextActive: { color: authColors.coral, fontFamily: 'Inter_600SemiBold' },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs, minHeight: 52, borderRadius: authRadius.pill, backgroundColor: authColors.coral, ...authShadow.cta },
  primaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.onCoral },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs, minHeight: 52, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.ink },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
