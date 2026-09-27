import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppointmentArrivalState, AppointmentDto, AppointmentStatus, CustomerDto, ServiceOfferingDto, TeamMemberDto } from '../apiTypes';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { combineLocalDateTime, localDateKey, localTime } from '../domain/calendar';
import { appointmentCommunicationEvents } from '../domain/appointmentCommunication';
import { useProviderLocationShare } from '../hooks/useProviderLocationShare';
import { ApiError } from '../services/api';
import { appointmentsApi, customersApi, servicesApi, teamApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { m3, m3Radius, m3Shadow, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { RootStackParamList } from '../types';
import { formatDateTime, formatMoney, titleCase } from '../utils/format';

export function AppointmentEditorScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'AppointmentEditor'>>();
  const { business } = useAuth();
  const id = route.params?.appointmentId;
  const initialStart = useMemo(() => {
    const value = new Date();
    value.setMinutes(Math.ceil(value.getMinutes() / 30) * 30, 0, 0);
    if (route.params?.date) {
      const [year, month, day] = route.params.date.split('-').map(Number);
      value.setFullYear(year!, month! - 1, day);
    }
    return value;
  }, [route.params?.date]);
  const initialEnd = useMemo(() => new Date(initialStart.getTime() + 60 * 60_000), [initialStart]);
  const [appointment, setAppointment] = useState<AppointmentDto | null>(null);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [members, setMembers] = useState<TeamMemberDto[]>([]);
  const [offerings, setOfferings] = useState<ServiceOfferingDto[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [serviceOfferingId, setServiceOfferingId] = useState('');
  const [service, setService] = useState(business?.defaultServices?.[0] ?? '');
  const [date, setDate] = useState(localDateKey(initialStart));
  const [startTime, setStartTime] = useState(localTime(initialStart));
  const [endTime, setEndTime] = useState(localTime(initialEnd));
  const [price, setPrice] = useState('');
  const [notes, setNotes] = useState('');
  const [reminder, setReminder] = useState('60');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paid, setPaid] = useState('0');
  const [notifyOnArrival, setNotifyOnArrival] = useState(false);
  const locationShare = useProviderLocationShare(id);

  useEffect(() => {
    void Promise.all([customersApi.list('', 1, 100), teamApi.listMembers(), servicesApi.list(true), id ? appointmentsApi.get(id) : Promise.resolve(null)])
      .then(([customerPage, team, catalog, existing]) => {
        setCustomers(customerPage.items);
        setMembers(team.filter((item) => item.status === 'ACTIVE'));
        setOfferings(catalog);
        if (existing) {
          setAppointment(existing);
          setCustomerId(existing.customerId ?? '');
          setMemberId(existing.assignedMemberId ?? '');
          setServiceOfferingId(existing.serviceOfferingId ?? '');
          setService(existing.serviceName);
          const start = new Date(existing.startsAt);
          const end = new Date(existing.endsAt);
          setDate(localDateKey(start));
          setStartTime(localTime(start));
          setEndTime(localTime(end));
          setPrice(existing.price == null ? '' : String(existing.price));
          setNotes(existing.notes ?? '');
          setReminder(existing.reminderMinutes == null ? '' : String(existing.reminderMinutes));
        } else if (catalog[0]) {
          setServiceOfferingId(catalog[0].id);
          setService(catalog[0].name);
          setPrice(catalog[0].price == null ? '' : String(catalog[0].price));
          setEndTime(localTime(new Date(initialStart.getTime() + catalog[0].durationMinutes * 60_000)));
        }
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Unable to load appointment.'))
      .finally(() => setLoading(false));
  }, [id, initialStart]);
  useEffect(() => { if (appointment) setPaid(String(appointment.paidAmount ?? 0)); }, [appointment]);

  const selectService = (offering: ServiceOfferingDto) => {
    setServiceOfferingId(offering.id);
    setService(offering.name);
    setPrice(offering.price == null ? '' : String(offering.price));
    const start = combineLocalDateTime(date, startTime);
    if (start) setEndTime(localTime(new Date(new Date(start).getTime() + offering.durationMinutes * 60_000)));
    if (memberId && offering.assignments.length && !offering.assignments.some((item) => item.businessMemberId === memberId)) setMemberId('');
  };
  const eligibleMembers = useMemo(() => {
    const selected = offerings.find((item) => item.id === serviceOfferingId);
    if (!selected?.assignments.length) return members;
    const ids = new Set(selected.assignments.map((item) => item.businessMemberId));
    return members.filter((item) => ids.has(item.id));
  }, [members, offerings, serviceOfferingId]);

  const save = async () => {
    if (saving) return;
    const startsAt = combineLocalDateTime(date, startTime);
    const endsAt = combineLocalDateTime(date, endTime);
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt)) {
      setError('Enter a valid date and an end time after the start time.');
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      customerId: customerId || undefined,
      assignedMemberId: memberId || undefined,
      serviceOfferingId: serviceOfferingId || undefined,
      serviceName: service.trim(),
      startsAt,
      endsAt,
      price: price ? Number(price) : undefined,
      notes: notes.trim() || undefined,
      reminderMinutes: reminder ? Number(reminder) : null,
    };
    try {
      if (id) await appointmentsApi.patch(id, body);
      else await appointmentsApi.create(body);
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to save appointment.');
    } finally {
      setSaving(false);
    }
  };
  const transition = async (status: AppointmentStatus) => {
    if (!id || saving) return;
    setSaving(true);
    setError(null);
    try {
      const next = await appointmentsApi.transition(id, status);
      setAppointment(next);
      if (status !== 'CONFIRMED') navigation.goBack();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to update appointment.');
    } finally {
      setSaving(false);
    }
  };
  const sendConfirmation = async () => {
    if (!id || saving) return;
    setSaving(true);
    setError(null);
    try {
      setAppointment(await appointmentsApi.sendConfirmation(id));
      Alert.alert('Confirmation sent', 'The customer confirmation was accepted for delivery.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to send confirmation.');
    } finally {
      setSaving(false);
    }
  };
  const savePayment = async () => {
    if (!id || saving) return;
    setSaving(true);
    setError(null);
    try {
      setAppointment(await appointmentsApi.updatePayment(id, Number(paid)));
      Alert.alert('Payment updated', 'The collected amount is now reflected in revenue reporting.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to update payment.');
    } finally {
      setSaving(false);
    }
  };
  const setArrival = async (state: AppointmentArrivalState | null) => {
    if (!id || saving) return;
    setSaving(true);
    setError(null);
    try {
      if (state !== 'ON_MY_WAY' && state !== 'RUNNING_LATE') await locationShare.stop();
      setAppointment(state ? await appointmentsApi.setArrival(id, state, notifyOnArrival) : await appointmentsApi.clearArrival(id));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to update arrival status.');
    } finally {
      setSaving(false);
    }
  };
  const enRoute = appointment?.arrivalState === 'ON_MY_WAY' || appointment?.arrivalState === 'RUNNING_LATE';

  if (loading) {
    return (
      <M3Screen header={<M3Header businessName="Appointment" onBack={() => navigation.goBack()} />}>
        <M3Loading label="Loading appointment…" />
      </M3Screen>
    );
  }

  const closed = appointment ? ['COMPLETED', 'CANCELED', 'NO_SHOW'].includes(appointment.status) : false;
  const noShowEligible = appointment ? new Date(appointment.startsAt).getTime() <= Date.now() : false;
  const communicationEvents = appointment ? appointmentCommunicationEvents(appointment) : [];

  const header = <M3Header businessName={id ? 'Appointment details' : 'Add appointment'} onBack={() => navigation.goBack()} />;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
      <M3Screen header={header}>
        <View style={styles.titleRow}>
          <Text style={styles.eyebrow}>{id ? titleCase(appointment?.status ?? '') : 'NEW APPOINTMENT'}</Text>
          <Text style={styles.title}>{id ? 'Appointment details' : 'Add appointment'}</Text>
          <Text style={styles.subtitle}>Schedule real work and keep the customer journey connected.</Text>
        </View>

        <FieldGroup label="Customer">
          <View style={styles.choices}>
            <Choice label="Walk-in / no customer" active={!customerId} onPress={() => setCustomerId('')} disabled={closed} />
            {customers.map((item) => (
              <Choice key={item.id} label={item.name} active={customerId === item.id} onPress={() => setCustomerId(item.id)} disabled={closed} />
            ))}
          </View>
        </FieldGroup>

        <FieldGroup label="Service">
          <View style={styles.choices}>
            {offerings.map((item) => (
              <Choice key={item.id} label={`${item.name} · ${item.durationMinutes} min`} active={serviceOfferingId === item.id} onPress={() => selectService(item)} disabled={closed} />
            ))}
          </View>
          {!offerings.length ? <Field label="Service name" value={service} onChangeText={setService} editable={!closed} /> : null}
        </FieldGroup>

        <FieldGroup label="Team member">
          <View style={styles.choices}>
            <Choice label="Unassigned" active={!memberId} onPress={() => setMemberId('')} disabled={closed} />
            {eligibleMembers.map((item) => (
              <Choice key={item.id} label={item.name} active={memberId === item.id} onPress={() => setMemberId(item.id)} disabled={closed} />
            ))}
          </View>
        </FieldGroup>

        <View style={styles.card}>
          <Text style={styles.cardHeading}>Schedule</Text>
          <Field label="Date (YYYY-MM-DD)" value={date} onChangeText={setDate} editable={!closed} />
          <View style={styles.row}>
            <View style={styles.flex}>
              <Field label="Start (HH:MM)" value={startTime} onChangeText={setStartTime} editable={!closed} />
            </View>
            <View style={styles.flex}>
              <Field label="End (HH:MM)" value={endTime} onChangeText={setEndTime} editable={!closed} />
            </View>
          </View>
          <View style={styles.row}>
            <View style={styles.flex}>
              <Field label="Price" value={price} onChangeText={setPrice} keyboardType="decimal-pad" editable={!closed} />
            </View>
            <View style={styles.flex}>
              <Field label="Remind me before (minutes)" value={reminder} onChangeText={setReminder} keyboardType="number-pad" editable={!closed} />
            </View>
          </View>
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline editable={!closed} />
        </View>

        {appointment ? (
          <View style={styles.card}>
            <Text style={styles.cardHeading}>
              Payment · {appointment.paymentStatus === 'partially_paid' ? 'Partially paid' : appointment.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
              {appointment.depositAmount ? ` · Deposit ${appointment.depositAmount}` : ''}
            </Text>
            <View style={styles.row}>
              <View style={styles.flex}>
                <Field label="Amount collected" value={paid} onChangeText={setPaid} keyboardType="decimal-pad" />
              </View>
              <View style={styles.flex}>
                <SecondaryButton fullWidth disabled={saving || Number(paid) < 0} label="Update payment" onPress={() => void savePayment()} />
              </View>
            </View>
          </View>
        ) : null}

        {appointment && !closed ? (
          <View style={styles.card}>
            <Text style={styles.cardHeading}>Arrival status</Text>
            <View style={styles.choices}>
              <Choice label="On my way" active={appointment.arrivalState === 'ON_MY_WAY'} onPress={() => void setArrival('ON_MY_WAY')} disabled={saving} />
              <Choice label="Running late" active={appointment.arrivalState === 'RUNNING_LATE'} onPress={() => void setArrival('RUNNING_LATE')} disabled={saving} />
              <Choice label="Arrived" active={appointment.arrivalState === 'ARRIVED'} onPress={() => void setArrival('ARRIVED')} disabled={saving} />
              {appointment.arrivalState ? <Choice label="Clear" active={false} onPress={() => void setArrival(null)} disabled={saving} /> : null}
            </View>
            {appointment.customerId ? (
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: notifyOnArrival }} onPress={() => setNotifyOnArrival((value) => !value)} style={styles.notifyRow}>
                <View style={[styles.checkbox, notifyOnArrival && styles.checkboxOn]}>
                  {notifyOnArrival ? <Icon name="check" size={14} color={m3.primary} /> : null}
                </View>
                <Text style={styles.notifyText}>Text the customer when I set this</Text>
              </Pressable>
            ) : null}
            {appointment.arrivalCustomerNotifiedAt ? <Text style={styles.meta}>Customer last notified {formatDateTime(appointment.arrivalCustomerNotifiedAt)}</Text> : null}

            {enRoute && appointment.customerId ? (
              <View style={styles.shareBox}>
                {locationShare.sharing ? (
                  <>
                    <View style={styles.shareOnRow}>
                      <View style={styles.shareDot} />
                      <Text style={styles.shareOnText}>Sharing your live location with the customer</Text>
                    </View>
                    <SecondaryButton fullWidth label="Stop sharing" onPress={() => void locationShare.stop()} />
                  </>
                ) : (
                  <>
                    <Text style={styles.meta}>Let the customer see you approaching. Sharing is only while this screen is open and stops when you arrive.</Text>
                    <SecondaryButton fullWidth disabled={locationShare.busy} label={locationShare.busy ? 'Starting…' : 'Share live location with customer'} onPress={() => void locationShare.start()} />
                  </>
                )}
                {locationShare.permissionDenied ? <Text style={styles.meta}>Location permission is off. Arrival updates still work without it.</Text> : null}
                {locationShare.error ? <Text style={styles.error}>{locationShare.error}</Text> : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {!closed ? (
          <PrimaryButton fullWidth disabled={saving || !service.trim()} label={saving ? 'Saving…' : id ? 'Save appointment' : 'Create appointment'} onPress={() => void save()} />
        ) : null}

        {appointment?.paymentTransactions?.length ? (
          <View>
            <Text style={styles.sectionLabel}>Payment history</Text>
            {appointment.paymentTransactions.map((item) => (
              <View key={item.id} style={styles.historyRow}>
                <View style={styles.flex}>
                  <Text style={styles.historyTitle}>{titleCase(item.kind)} · {formatMoney(item.amount, item.currency)}</Text>
                  <Text style={styles.meta}>
                    {titleCase(item.status)} · {formatDateTime(item.paidAt ?? item.createdAt)}
                    {Number(item.refundedAmount) > 0 ? ` · Refunded ${formatMoney(item.refundedAmount, item.currency)}` : ''}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {appointment?.customerId ? (
          <View>
            <Text style={styles.sectionLabel}>Customer communication</Text>
            {communicationEvents.length ? (
              communicationEvents.map((item) => (
                <View key={item.key} style={styles.historyRow}>
                  <View style={styles.flex}>
                    <Text style={styles.historyTitle}>{item.label}</Text>
                    <Text style={styles.meta}>Sent {formatDateTime(item.sentAt)}</Text>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.meta}>No customer messages have been sent for this appointment yet.</Text>
            )}
          </View>
        ) : null}

        {appointment?.customerId && !appointment.confirmationSentAt && !closed ? (
          <SecondaryButton fullWidth disabled={saving} label="Send customer confirmation" onPress={() => void sendConfirmation()} />
        ) : null}
        {appointment?.status === 'SCHEDULED' ? <SecondaryButton fullWidth disabled={saving} label="Confirm appointment" onPress={() => void transition('CONFIRMED')} /> : null}
        {appointment?.status === 'CONFIRMED' ? <PrimaryButton fullWidth disabled={saving} label="Mark completed" onPress={() => void transition('COMPLETED')} /> : null}
        {appointment && !closed ? (
          <View style={styles.row}>
            <View style={styles.flex}>
              <SecondaryButton
                fullWidth
                disabled={saving || !noShowEligible}
                label="No show"
                onPress={() =>
                  Alert.alert(
                    'Mark as no-show?',
                    noShowEligible
                      ? 'This records that the customer did not attend. It is a final outcome and cannot be undone. If follow-up is enabled in Business settings, the customer gets one polite reschedule message.'
                      : '',
                    [
                      { text: 'Not now', style: 'cancel' },
                      { text: 'Mark no-show', style: 'destructive', onPress: () => void transition('NO_SHOW') },
                    ],
                  )
                }
              />
            </View>
            <View style={styles.flex}>
              <SecondaryButton
                fullWidth
                disabled={saving}
                label="Cancel"
                onPress={() =>
                  Alert.alert('Cancel appointment?', 'The appointment will remain in history.', [
                    { text: 'Keep', style: 'cancel' },
                    { text: 'Cancel appointment', style: 'destructive', onPress: () => void transition('CANCELED') },
                  ])
                }
              />
            </View>
          </View>
        ) : null}
        {appointment && !closed && !noShowEligible ? <Text style={styles.meta}>No-show can be recorded once the appointment start time has passed.</Text> : null}
      </M3Screen>
    </KeyboardAvoidingView>
  );
}

function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}
function Choice({ label, active, onPress, disabled }: { label: string; active: boolean; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress}>
      <Chip label={label} selected={active} />
    </Pressable>
  );
}
function Field({
  label,
  multiline,
  ...props
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: 'decimal-pad' | 'number-pad';
  editable?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        {...props}
        multiline={multiline}
        placeholderTextColor={m3.onSurfaceVariant}
        style={[styles.input, multiline && styles.multiline, props.editable === false && styles.disabled]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },

  titleRow: { gap: 2 },
  eyebrow: { ...m3Type.labelSm, color: m3.secondary, letterSpacing: 0.6 },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },

  fieldGroup: { gap: m3Space.xs },
  sectionLabel: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.5, marginBottom: 4 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },

  card: { backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.lg, padding: m3Space.md, gap: m3Space.sm, ...m3Shadow.card },
  cardHeading: { ...m3Type.titleMd, color: m3.onSurface },

  fieldWrap: { gap: 4 },
  label: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  input: { minHeight: 46, backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.md, paddingHorizontal: m3Space.sm, ...m3Type.bodyMd, color: m3.onSurface },
  multiline: { minHeight: 90, paddingTop: m3Space.xs, textAlignVertical: 'top' },
  disabled: { opacity: 0.6 },
  row: { flexDirection: 'row', gap: m3Space.sm },

  meta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
  error: { ...m3Type.bodySm, color: m3.error },

  notifyRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.xs, marginTop: m3Space.xs },
  checkbox: { width: 22, height: 22, borderRadius: m3Radius.sm, borderWidth: 1, borderColor: m3.outlineVariant, alignItems: 'center', justifyContent: 'center', backgroundColor: m3.surfaceContainerLowest },
  checkboxOn: { borderColor: m3.primary, backgroundColor: m3.primaryFixed },
  notifyText: { ...m3Type.bodySm, color: m3.onSurfaceVariant },

  shareBox: { marginTop: m3Space.xs, padding: m3Space.sm, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainerLow, gap: m3Space.sm },
  shareOnRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  shareDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: m3.secondary },
  shareOnText: { ...m3Type.bodySm, color: m3.onSurface },

  historyRow: { flexDirection: 'row', padding: m3Space.sm, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainerLowest, marginBottom: m3Space.xs, ...m3Shadow.card },
  historyTitle: { ...m3Type.bodyMd, color: m3.onSurface },
});
