import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { BookableServicesDto, BookingAvailabilityDto } from '../../apiTypes';
import { formatServiceMeta, formatSlotTime, groupSlotsByDay } from '../../domain/booking';
import type { AssistantBookingFormRequest } from '../../domain/customerAssistant';
import { ApiError } from '../../services/api';
import { bookingApi } from '../endpoints';
import { premium } from '../premiumTheme';

const HORIZON_DAYS = 14;

function dayLabel(day: string): string {
  return new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${day}T12:00:00`));
}

/**
 * A small booking form shown inside the assistant chat. Service, day and time
 * come from the server; the booking is made by the customer's own Confirm tap
 * through the normal booking endpoint, never by the AI.
 */
export function AssistantBookingCard({ request, onOpenBooking }: { request: AssistantBookingFormRequest; onOpenBooking: (bookingId: string) => void }) {
  const [services, setServices] = useState<BookableServicesDto | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(request.serviceOfferingId);
  const [availability, setAvailability] = useState<BookingAvailabilityDto | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ id: string; when: string } | null>(null);

  useEffect(() => {
    let live = true;
    bookingApi.services(request.slug)
      .then((result) => {
        if (!live) return;
        setServices(result);
        // One service needs no choosing.
        if (!request.serviceOfferingId && result.services.length === 1) setServiceId(result.services[0].id);
      })
      .catch((caught) => { if (live) setError(caught instanceof ApiError ? caught.message : 'Could not load services.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [request.slug, request.serviceOfferingId]);

  useEffect(() => {
    if (!serviceId) return;
    let live = true;
    setLoadingSlots(true); setAvailability(null); setDay(null); setStartsAt(null); setError(null);
    const from = new Date();
    const to = new Date(from.getTime() + HORIZON_DAYS * 86_400_000);
    bookingApi.availability(request.slug, serviceId, from.toISOString(), to.toISOString())
      .then((result) => { if (live) setAvailability(result); })
      .catch((caught) => { if (live) setError(caught instanceof ApiError ? caught.message : 'Could not load times.'); })
      .finally(() => { if (live) setLoadingSlots(false); });
    return () => { live = false; };
  }, [request.slug, serviceId]);

  const timezone = availability?.timezone ?? 'UTC';
  const days = useMemo(() => (availability ? groupSlotsByDay(availability.slots, timezone) : []), [availability, timezone]);
  const daySlots = days.find((g) => g.day === day)?.slots ?? [];
  const service = services?.services.find((s) => s.id === serviceId) ?? null;

  const confirm = async () => {
    if (submitting || !serviceId || !startsAt) return;
    setSubmitting(true); setError(null);
    try {
      const result = await bookingApi.create({ slug: request.slug, serviceOfferingId: serviceId, assignedMemberId: memberId, startsAt, smsConsent: false });
      setBooked({ id: result.appointment.id, when: `${dayLabel(day ?? '')} at ${formatSlotTime(startsAt, timezone)}` });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create this booking.');
    } finally {
      setSubmitting(false);
    }
  };

  if (booked) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>You are booked in</Text>
        <Text style={styles.line}>{service?.name ?? 'Appointment'} · {booked.when}</Text>
        <Pressable accessibilityRole="button" onPress={() => onOpenBooking(booked.id)} style={({ pressed }) => [styles.confirm, pressed && styles.pressed]}>
          <Text style={styles.confirmText}>View booking</Text>
        </Pressable>
      </View>
    );
  }

  const canConfirm = Boolean(startsAt) && !submitting;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Book at {services?.businessName ?? request.businessName ?? 'this business'}</Text>
      {loading ? <ActivityIndicator color={premium.deep} /> : null}

      {services && services.services.length > 1 ? (
        <>
          <Text style={styles.label}>SERVICE</Text>
          <View style={styles.wrap}>
            {services.services.map((s) => (
              <Pressable key={s.id} accessibilityRole="button" accessibilityState={{ selected: s.id === serviceId }} onPress={() => setServiceId(s.id)} style={[styles.chip, s.id === serviceId && styles.chipOn]}>
                <Text style={[styles.chipText, s.id === serviceId && styles.chipTextOn]}>{s.name}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      {service ? <Text style={styles.meta}>{service.name} · {formatServiceMeta(service, services?.currency ?? '')}</Text> : null}

      {serviceId ? <Text style={styles.label}>DAY</Text> : null}
      {loadingSlots ? <ActivityIndicator color={premium.deep} /> : null}
      {serviceId && !loadingSlots && availability && !days.length ? <Text style={styles.meta}>No open times in the next {HORIZON_DAYS} days.</Text> : null}
      {days.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {days.map((g) => (
            <Pressable key={g.day} accessibilityRole="button" accessibilityState={{ selected: g.day === day }} onPress={() => { setDay(g.day); setStartsAt(null); }} style={[styles.chip, g.day === day && styles.chipOn]}>
              <Text style={[styles.chipText, g.day === day && styles.chipTextOn]}>{dayLabel(g.day)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      {day ? <Text style={styles.label}>TIME</Text> : null}
      {day ? (
        <View style={styles.wrap}>
          {daySlots.map((slot) => (
            <Pressable
              key={slot.startsAt}
              accessibilityRole="button"
              accessibilityState={{ selected: slot.startsAt === startsAt }}
              onPress={() => { setStartsAt(slot.startsAt); setMemberId(slot.members.length === 1 ? slot.members[0].id : undefined); }}
              style={[styles.chip, slot.startsAt === startsAt && styles.chipOn]}
            >
              <Text style={[styles.chipText, slot.startsAt === startsAt && styles.chipTextOn]}>{formatSlotTime(slot.startsAt, timezone)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: !canConfirm }} disabled={!canConfirm} onPress={() => void confirm()} style={({ pressed }) => [styles.confirm, !canConfirm && styles.disabled, pressed && styles.pressed]}>
        <Text style={styles.confirmText}>{submitting ? 'Booking…' : 'Confirm booking'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: premium.card, borderRadius: 18, borderWidth: 1, borderColor: premium.line, padding: 14, gap: 8, marginTop: 8, maxWidth: 340 },
  title: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.ink },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.8, color: premium.inkFaint, marginTop: 4 },
  meta: { fontFamily: 'Inter_400Regular', fontSize: 13, color: premium.inkSoft },
  line: { fontFamily: 'Inter_500Medium', fontSize: 14, color: premium.ink },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  chip: { borderRadius: 14, borderWidth: 1, borderColor: premium.line, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: premium.bg },
  chipOn: { backgroundColor: premium.deep, borderColor: premium.deep },
  chipText: { fontFamily: 'Inter_500Medium', fontSize: 13, color: premium.ink },
  chipTextOn: { color: premium.onDeep },
  error: { fontFamily: 'Inter_400Regular', fontSize: 13, color: premium.danger },
  confirm: { backgroundColor: premium.deep, borderRadius: 14, paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  confirmText: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5, color: premium.onDeep },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
});
