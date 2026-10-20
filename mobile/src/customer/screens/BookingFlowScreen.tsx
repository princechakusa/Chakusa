import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ErrorState, LoadingState, Screen } from '../../components/ui';
import type { BookableServicesDto, BookingAvailabilityDto } from '../../apiTypes';
import {
  BookingDraft, canAdvanceFrom, currentBookingStep, emptyDraft, formatServiceMeta,
  formatSlotTime, groupSlotsByDay, slotsForStaff, staffOptions,
} from '../../domain/booking';
import { ApiError } from '../../services/api';
import { authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ServiceRow } from '../components/cards';
import { memberPriceDisplay } from '../domain/customerLoyalty';
import { bookingApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';
import { premium } from '../premiumTheme';

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
  // Appointment-text opt-in: explicit and unticked by default (Twilio toll-free verification).
  const [smsConsent, setSmsConsent] = useState(false);

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
        smsConsent,
      });
      navigation.replace('BookingDetail', { bookingId: result.appointment.id });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create this booking.');
      setSubmitting(false);
    }
  };

  if (loadingServices) return <Screen backgroundColor={premium.bg}><LoadingState label="Loading services…" /></Screen>;
  if (error && !services) return <Screen backgroundColor={premium.bg}><ErrorState message={error} onRetry={() => navigation.replace('BookingFlow', route.params)} /></Screen>;

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <Screen backgroundColor={premium.bg}>
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
              <SelectField
                placeholder="Choose a date"
                value={draft.date}
                options={dayGroups.map((group) => ({
                  key: group.day,
                  label: new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: timezone }).format(new Date(group.slots[0].startsAt)),
                }))}
                onSelect={(day) => setDraft((d) => ({ ...d, date: day, startsAt: null }))}
              />
            )}
        </>
      ) : null}

      {draft.date ? (
        <>
          <Text style={styles.groupLabel}>Time</Text>
          <SelectField
            placeholder="Choose a time"
            value={draft.startsAt}
            options={daySlots.map((slot) => ({ key: slot.startsAt, label: formatSlotTime(slot.startsAt, timezone) }))}
            onSelect={(startsAt) => setDraft((d) => ({ ...d, startsAt }))}
          />
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

      {step === 'confirm' && selectedService ? (
        <Pressable
          testID="sms-consent"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: smsConsent }}
          aria-checked={smsConsent}
          accessibilityLabel="Text me appointment confirmations and reminders"
          onPress={() => setSmsConsent((value) => !value)}
          style={styles.consentRow}
        >
          <Ionicons name={smsConsent ? 'checkbox' : 'square-outline'} size={22} color={smsConsent ? premium.deep : premium.inkFaint} />
          <Text style={styles.consentText}>
            Text me about this appointment. I agree to receive appointment text messages (confirmations, reminders and updates) from {services?.businessName ?? 'this business'} via Chakusa at the phone number on my account. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of booking. See chakusarecovery.com/sms.
          </Text>
        </Pressable>
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

interface SelectOption { key: string; label: string; }

// A single tap target that opens a bottom-sheet list, instead of dumping
// every option as wrapping pills - the arrangement customers actually
// asked for once a business has more than a handful of open days/times.
function SelectField({ placeholder, value, options, onSelect }: { placeholder: string; value: string | null; options: SelectOption[]; onSelect: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.key === value) ?? null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={selected ? selected.label : placeholder}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.select, pressed && styles.pressed]}
      >
        <Text style={[styles.selectText, !selected && styles.selectPlaceholder]} numberOfLines={1}>
          {selected ? selected.label : placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={premium.inkSoft} />
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
                    {isActive ? <Ionicons name="checkmark" size={18} color={premium.deep} /> : null}
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
  eyebrow: { ...authType.micro, color: premium.deep },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  progressRow: { flexDirection: 'row', gap: authSpace.xxs, marginBottom: authSpace.sm },
  progressSegment: { flex: 1, height: 4, borderRadius: authRadius.pill, backgroundColor: premium.sageSoft },
  progressSegmentActive: { backgroundColor: premium.deep },
  memberBanner: { padding: authSpace.sm, borderRadius: authRadius.md, borderWidth: 1, borderColor: premium.deep, backgroundColor: premium.sageSoft },
  memberBannerText: { ...authType.body, fontSize: 12, color: premium.ink },
  groupLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: premium.ink, marginTop: authSpace.sm },
  list: { gap: authSpace.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: authSpace.xs },
  chip: { minHeight: 38, paddingHorizontal: authSpace.md, justifyContent: 'center', borderRadius: authRadius.pill, borderWidth: 1, borderColor: premium.line, backgroundColor: premium.card },
  chipActive: { backgroundColor: premium.deep, borderColor: premium.deep },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: premium.inkSoft },
  chipTextActive: { color: premium.onDeep },
  empty: { ...authType.body, fontSize: 13 },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingHorizontal: authSpace.md, borderRadius: authRadius.md, borderWidth: 1, borderColor: premium.line, backgroundColor: premium.card },
  selectText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: premium.ink, flex: 1 },
  selectPlaceholder: { color: premium.inkFaint, fontFamily: 'Inter_400Regular' },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(14,17,22,0.45)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '70%', backgroundColor: premium.card, borderTopLeftRadius: authRadius.xl, borderTopRightRadius: authRadius.xl, padding: authSpace.lg },
  sheetTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: premium.ink, marginBottom: authSpace.xs },
  sheetList: { flexGrow: 0 },
  sheetRow: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: premium.sageSoft },
  sheetRowText: { fontFamily: 'Inter_500Medium', fontSize: 15, color: premium.ink },
  sheetRowTextActive: { color: premium.deep, fontFamily: 'Inter_600SemiBold' },
  summary: { padding: authSpace.md, borderRadius: authRadius.lg, borderWidth: 1, borderColor: premium.line, backgroundColor: premium.card, gap: authSpace.xxs, ...authShadow.card },
  summaryTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.ink },
  summaryLine: { ...authType.body, fontSize: 13 },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: authSpace.sm, paddingVertical: authSpace.xs },
  consentText: { ...authType.body, flex: 1, fontSize: 12, lineHeight: 18, color: premium.inkSoft },
  error: { ...authType.body, fontSize: 12, color: premium.danger },
  primaryBtn: { minHeight: 52, borderRadius: authRadius.pill, backgroundColor: premium.deep, alignItems: 'center', justifyContent: 'center', ...authShadow.cta },
  primaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.onDeep },
  secondaryBtn: { minHeight: 52, borderRadius: authRadius.pill, borderWidth: 1, borderColor: premium.line, backgroundColor: premium.card, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.ink },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
