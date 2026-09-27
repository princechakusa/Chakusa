import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ErrorState, LoadingState, Screen } from '../../components/ui';
import type { BookableServicesDto, BookingAvailabilityDto } from '../../apiTypes';
import {
  BookingDraft, canAdvanceFrom, currentBookingStep, emptyDraft, formatServiceMeta,
  formatSlotTime, groupSlotsByDay, slotsForStaff, staffOptions,
} from '../../domain/booking';
import { ApiError } from '../../services/api';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ServiceRow } from '../components/cards';
import { memberPriceDisplay } from '../domain/customerLoyalty';
import { bookingApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'BookingFlow'>;

// PROGRAM 2 LOOP 7: the booking wizard. Every scheduling decision is the
// server's - this screen only walks the customer through
// service → staff → date → time → confirm using `domain/booking.ts`, then
// posts to `/customer/bookings`. No payment surface.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

const HORIZON_DAYS = 21;

function PrimaryBtn({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryBtn, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}>
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

export function BookingFlowScreen({ route, navigation }: Props) {
  const { slug, serviceId } = route.params;
  const [services, setServices] = useState<BookableServicesDto | null>(null);
  const [availability, setAvailability] = useState<BookingAvailabilityDto | null>(null);
  const [draft, setDraft] = useState<BookingDraft>({ ...emptyDraft, serviceId: serviceId ?? null, staffId: 'any' });
  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    bookingApi.services(slug)
      .then(setServices)
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : 'Could not load services.'))
      .finally(() => setLoadingServices(false));
  }, [slug]);

  const loadSlots = useCallback(async (id: string) => {
    setLoadingSlots(true);
    setError(null);
    try {
      const from = new Date();
      const to = new Date(from.getTime() + HORIZON_DAYS * 86_400_000);
      const staff = draft.staffId && draft.staffId !== 'any' ? draft.staffId : undefined;
      setAvailability(await bookingApi.availability(slug, id, from.toISOString(), to.toISOString(), staff));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load availability.');
    } finally {
      setLoadingSlots(false);
    }
  }, [slug, draft.staffId]);

  useEffect(() => { if (draft.serviceId) void loadSlots(draft.serviceId); }, [draft.serviceId, loadSlots]);

  const step = currentBookingStep(draft);
  const timezone = availability?.timezone ?? 'UTC';
  const dayGroups = useMemo(
    () => availability ? groupSlotsByDay(availability.slots, timezone) : [],
    [availability, timezone],
  );
  const staff = useMemo(() => availability ? staffOptions(availability.slots) : [], [availability]);
  const daySlots = useMemo(() => {
    if (!draft.date || !availability) return [];
    const group = dayGroups.find((g) => g.day === draft.date);
    return group ? slotsForStaff(group.slots, draft.staffId ?? 'any') : [];
  }, [availability, dayGroups, draft.date, draft.staffId]);

  const selectedService = services?.services.find((s) => s.id === draft.serviceId) ?? null;

  const submit = async () => {
    if (submitting || !draft.serviceId || !draft.startsAt) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await bookingApi.create({
        slug,
        serviceOfferingId: draft.serviceId,
        assignedMemberId: draft.staffId && draft.staffId !== 'any' ? draft.staffId : undefined,
        startsAt: draft.startsAt,
        notes: notes.trim() || undefined,
      });
      navigation.replace('BookingDetail', { bookingId: result.appointment.id });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create this booking.');
      setSubmitting(false);
    }
  };

  if (loadingServices) return <Screen backgroundColor={authColors.bg}><LoadingState label="Loading services…" /></Screen>;
  if (error && !services) return <Screen backgroundColor={authColors.bg}><ErrorState message={error} onRetry={() => navigation.replace('BookingFlow', route.params)} /></Screen>;

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <Screen backgroundColor={authColors.bg}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>NEW BOOKING</Text>
        <Text style={styles.title}>{services?.businessName ?? 'Book'}</Text>
        <Text style={styles.subtitle}>{stepLabel(step)}</Text>
      </View>
      <View style={styles.progressRow} accessibilityLabel={`Step ${stepIndex + 1} of ${STEP_ORDER.length}: ${stepLabel(step)}`}>
        {STEP_ORDER.map((s, index) => (
          <View key={s} style={[styles.progressSegment, index <= stepIndex && styles.progressSegmentActive]} />
        ))}
      </View>

      {services?.membership ? (
        <View style={styles.memberBanner}>
          <Text style={styles.memberBannerText}>
            {services.membership.planName} member - {services.membership.discountPercent}% off{services.membership.priorityBooking ? ' · priority booking' : ''}. Member prices shown below.
          </Text>
        </View>
      ) : null}

      {/* Service */}
      <Text style={styles.groupLabel}>Service</Text>
      <View style={styles.list}>
        {(services?.services ?? []).map((service) => {
          const member = memberPriceDisplay(service, services?.currency ?? null);
          const meta = member.hasMemberPrice
            ? `${formatServiceMeta(service, services?.currency ?? '')} · member ${member.member}`
            : formatServiceMeta(service, services?.currency ?? '');
          return (
            <ServiceRow
              key={service.id}
              name={service.name}
              meta={meta}
              selected={draft.serviceId === service.id}
              onPress={() => setDraft(() => ({ ...emptyDraft, serviceId: service.id, staffId: 'any' }))}
            />
          );
        })}
      </View>

      {draft.serviceId && staff.length > 1 ? (
        <>
          <Text style={styles.groupLabel}>Staff</Text>
          <View style={styles.chips}>
            <Chip label="Anyone" active={draft.staffId === 'any'} onPress={() => setDraft((d) => ({ ...d, staffId: 'any', date: null, startsAt: null }))} />
            {staff.map((member) => (
              <Chip key={member.id} label={member.name} active={draft.staffId === member.id} onPress={() => setDraft((d) => ({ ...d, staffId: member.id, date: null, startsAt: null }))} />
            ))}
          </View>
        </>
      ) : null}

      {draft.serviceId ? (
        <>
          <Text style={styles.groupLabel}>Date</Text>
          {loadingSlots ? <LoadingState label="Loading availability…" />
            : !dayGroups.length ? <Text style={styles.empty}>No open times in the next {HORIZON_DAYS} days. Try another staff member or check back later.</Text>
            : (
              <View style={styles.chips}>
                {dayGroups.map((group) => (
                  <Chip
                    key={group.day}
                    label={new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone }).format(new Date(group.slots[0].startsAt))}
                    active={draft.date === group.day}
                    onPress={() => setDraft((d) => ({ ...d, date: group.day, startsAt: null }))}
                  />
                ))}
              </View>
            )}
        </>
      ) : null}

      {draft.date ? (
        <>
          <Text style={styles.groupLabel}>Time</Text>
          <View style={styles.chips}>
            {daySlots.map((slot) => (
              <Chip
                key={slot.startsAt}
                label={formatSlotTime(slot.startsAt, timezone)}
                active={draft.startsAt === slot.startsAt}
                onPress={() => setDraft((d) => ({ ...d, startsAt: slot.startsAt }))}
              />
            ))}
          </View>
        </>
      ) : null}

      {step === 'confirm' && selectedService ? (
        <View style={styles.summary}>
          <Text style={styles.summaryTitle}>Confirm</Text>
          <Text style={styles.summaryLine}>{selectedService.name} · {formatServiceMeta(selectedService, services?.currency ?? '')}</Text>
          <Text style={styles.summaryLine}>
            {draft.startsAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short', timeZone: timezone }).format(new Date(draft.startsAt)) : ''}
          </Text>
          <Text style={styles.summaryLine}>
            {draft.staffId === 'any' || !draft.staffId ? 'With: anyone available' : `With: ${staff.find((m) => m.id === draft.staffId)?.name ?? 'selected staff'}`}
          </Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <PrimaryBtn
        label={submitting ? 'Booking…' : step === 'confirm' ? 'Confirm booking' : stepLabel(step)}
        disabled={submitting || !canAdvanceFrom('confirm', draft)}
        onPress={() => void submit()}
      />
      <SecondaryBtn label="Cancel" onPress={() => navigation.goBack()} />
    </Screen>
  );
}

const STEP_ORDER = ['service', 'staff', 'date', 'time', 'confirm'] as const;

function stepLabel(step: ReturnType<typeof currentBookingStep>): string {
  return { service: 'Choose a service', staff: 'Choose staff', date: 'Choose a date', time: 'Choose a time', confirm: 'Review & confirm' }[step];
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={active ? { selected: true } : {}}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  progressRow: { flexDirection: 'row', gap: authSpace.xxs, marginBottom: authSpace.sm },
  progressSegment: { flex: 1, height: 4, borderRadius: authRadius.pill, backgroundColor: authColors.lineSoft },
  progressSegmentActive: { backgroundColor: authColors.coral },
  memberBanner: { padding: authSpace.sm, borderRadius: authRadius.md, borderWidth: 1, borderColor: authColors.coral, backgroundColor: authColors.coralSoft },
  memberBannerText: { ...authType.body, fontSize: 12, color: authColors.ink },
  groupLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink, marginTop: authSpace.sm },
  list: { gap: authSpace.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: authSpace.xs },
  chip: { minHeight: 38, paddingHorizontal: authSpace.md, justifyContent: 'center', borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface },
  chipActive: { backgroundColor: authColors.coral, borderColor: authColors.coral },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: authColors.inkSoft },
  chipTextActive: { color: authColors.onCoral },
  empty: { ...authType.body, fontSize: 13 },
  summary: { padding: authSpace.md, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, gap: authSpace.xxs, ...authShadow.card },
  summaryTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.ink },
  summaryLine: { ...authType.body, fontSize: 13 },
  error: { ...authType.body, fontSize: 12, color: authColors.danger },
  primaryBtn: { minHeight: 52, borderRadius: authRadius.pill, backgroundColor: authColors.coral, alignItems: 'center', justifyContent: 'center', ...authShadow.cta },
  primaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.onCoral },
  secondaryBtn: { minHeight: 52, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.ink },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
