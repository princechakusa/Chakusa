import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { canSubmitContact, errorViewState, publicProfileShareMessage, publicProfileWhatsAppGreeting, PublicBusinessProfileViewState, workingHoursSummary } from '../domain/publicBusinessProfile';
import { ApiError } from '../services/api';
import { openCall, openWhatsApp } from '../services/messaging';
import { PublicAvailabilitySlot, publicBusinessProfileApi } from '../services/publicBusinessProfile';
import { colors, radius, shadows, spacing, typography } from '../theme';

export function PublicBusinessProfileScreen({ slug }: { slug: string | null }) {
  const [view, setView] = useState<PublicBusinessProfileViewState>(slug ? { kind: 'loading' } : { kind: 'invalid' });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceRequested, setServiceRequested] = useState('');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [bookingDate, setBookingDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<PublicAvailabilitySlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<{ startsAt: string; memberId: string } | null>(null);
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookingConfirmation, setBookingConfirmation] = useState<{ serviceName: string; startsAt: string; managementToken: string } | null>(null);

  const load = useCallback(async () => {
    if (!slug) { setView({ kind: 'invalid' }); return; }
    setView({ kind: 'loading' });
    try { setView({ kind: 'loaded', details: await publicBusinessProfileApi.get(slug) }); }
    catch (error) { setView(errorViewState(error instanceof ApiError ? error.kind : 'network')); }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

  const details = view.kind === 'loaded' || view.kind === 'submitting' || view.kind === 'submitted' ? view.details : null;
  useEffect(() => { if (details?.services[0] && !serviceId) setServiceId(details.services[0].id); }, [details, serviceId]);
  useEffect(() => {
    if (!slug || !serviceId || !bookingDate) return;
    const from = new Date(`${bookingDate}T00:00:00`); const to = new Date(from); to.setDate(to.getDate() + 1);
    if (Number.isNaN(from.getTime())) return;
    setBookingBusy(true); setSelectedSlot(null); setBookingError(null);
    void publicBusinessProfileApi.availability(slug, serviceId, from.toISOString(), to.toISOString()).then(setSlots).catch(() => { setSlots([]); setBookingError('Could not check availability. Please try again.'); }).finally(() => setBookingBusy(false));
  }, [bookingDate, serviceId, slug]);

  // Best-effort: a real browser tab gets the business's name and a
  // description-derived summary, matching PublicDocumentScreen's
  // document.title pattern. This does not help a non-JS-executing social
  // link-preview crawler (WhatsApp, Facebook) render a rich card — that
  // needs server-rendered Open Graph meta tags, which this Expo-web page
  // cannot produce on its own. Real browsers and JS-executing crawlers
  // (e.g. Googlebot) still benefit.
  useEffect(() => {
    if (typeof document === 'undefined' || !details) return;
    document.title = `${details.name} | Chakusa`;
    const description = details.description ?? `Contact ${details.name} on Chakusa.`;
    let meta = document.querySelector('meta[name="description"]');
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'description'); document.head.appendChild(meta); }
    meta.setAttribute('content', description);
  }, [details]);

  const submit = async () => {
    if (!slug || view.kind !== 'loaded' || !canSubmitContact(view, name, phone)) return;
    const details = view.details;
    setView({ kind: 'submitting', details });
    // Referral-program attribution only — a customer's personal share link
    // carries their own id as ?ref=, which the backend validates belongs to
    // this business (or silently ignores) before attributing the resulting
    // lead. Read directly from the URL rather than plumbed through
    // publicRoutes.ts, since it's a query param, not a path segment.
    const ref = typeof window === 'undefined' || !window.location ? undefined : new URLSearchParams(window.location.search).get('ref') ?? undefined;
    try {
      await publicBusinessProfileApi.submitContact(slug, {
        name: name.trim(),
        phone: phone.trim(),
        serviceRequested: serviceRequested.trim() || undefined,
        message: message.trim() || undefined,
        ref,
      });
      setView({ kind: 'submitted', details });
    } catch (error) {
      setView(errorViewState(error instanceof ApiError ? error.kind : 'network'));
    }
  };

  const hours = details ? workingHoursSummary(details.workingHours) : null;
  const book = async () => {
    if (!slug || !selectedSlot || !name.trim() || !phone.trim()) return;
    setBookingBusy(true); setBookingError(null);
    try { const result = await publicBusinessProfileApi.book(slug, { serviceOfferingId: serviceId, assignedMemberId: selectedSlot.memberId, startsAt: selectedSlot.startsAt, name: name.trim(), phone: phone.trim(), email: email.trim() || undefined, notes: message.trim() || undefined }); setBookingConfirmation({ serviceName: result.appointment.serviceName, startsAt: result.appointment.startsAt, managementToken: result.managementToken }); }
    catch (error) { setBookingError(error instanceof ApiError ? error.message : 'Could not create this booking. Please choose another time.'); }
    finally { setBookingBusy(false); }
  };
  const shareProfile = async () => {
    if (typeof window === 'undefined' || !details) return;
    try { await Share.share({ message: publicProfileShareMessage(details.name, window.location.href) }); } catch { /* dismissed */ }
  };

  return <SafeAreaView style={styles.page}><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"><View style={styles.shell}><Text style={styles.brand}>CHAKUSA</Text><View style={styles.card} accessibilityLiveRegion="polite">
    {view.kind === 'loading' ? <State icon="hourglass-outline" title="Loading business page…"><ActivityIndicator color={colors.primary} accessibilityLabel="Loading business page" /></State> : null}
    {view.kind === 'network-error' ? <State icon="cloud-offline-outline" title="We couldn’t load this page" body="Check your connection and try again."><Action label="Try again" onPress={() => void load()} /></State> : null}
    {view.kind === 'invalid' ? <State icon="link-outline" title="This business page is unavailable." body="Please check the link you received." /> : null}
    {details && view.kind === 'submitted' ? <State icon="checkmark-circle-outline" title="Thanks for reaching out!" body={`${details.name} will get back to you soon.`} /> : null}
    {details && (view.kind === 'loaded' || view.kind === 'submitting') ? <View style={styles.form}>
      <Text style={styles.business}>{details.name}</Text>
      {details.industry ? <Text style={styles.service}>{details.industry}</Text> : null}
      {details.description ? <Text style={styles.description}>{details.description}</Text> : null}
      <View style={styles.infoRows}>
        {hours ? <Row icon="time-outline" text={hours} /> : null}
        {details.phone ? <Row icon="call-outline" text={details.phone} /> : null}
      </View>
      {details.defaultServices && details.defaultServices.length > 0 ? <View style={styles.serviceChips}>{details.defaultServices.map(service => <View key={service} style={styles.serviceChip}><Text style={styles.serviceChipText}>{service}</Text></View>)}</View> : null}

      {details.phone ? <View style={styles.contactActions}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Call ${details.name}`} onPress={() => void openCall(details.phone!)} style={styles.contactButton}><Ionicons color={colors.text} name="call" size={18} /><Text style={styles.contactButtonText}>Call</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Message ${details.name} on WhatsApp`} onPress={() => void openWhatsApp(details.phone!, publicProfileWhatsAppGreeting(details.name))} style={[styles.contactButton, styles.contactButtonWhatsApp]}><Ionicons color={colors.surface} name="logo-whatsapp" size={18} /><Text style={[styles.contactButtonText, styles.contactButtonTextWhatsApp]}>WhatsApp</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Share this business page" onPress={() => void shareProfile()} style={styles.contactButton}><Ionicons color={colors.text} name="share-social-outline" size={18} /><Text style={styles.contactButtonText}>Share</Text></Pressable>
      </View> : null}

      {details.services.length ? bookingConfirmation ? <State icon="checkmark-circle-outline" title="Your appointment is booked" body={`${bookingConfirmation.serviceName} · ${new Date(bookingConfirmation.startsAt).toLocaleString()}`}><Text selectable style={styles.manageHint}>Save your secure booking link to view or cancel this appointment.</Text><Action label="Manage booking" onPress={() => { if (typeof window !== 'undefined' && window.location && slug) window.location.href = `/b/${encodeURIComponent(slug)}/booking/${encodeURIComponent(bookingConfirmation.managementToken)}`; }} /></State> : <View style={styles.booking}>
        <Text style={styles.title}>Book an appointment</Text>
        <Text style={styles.label}>Choose a service</Text><View style={styles.serviceChips}>{details.services.map(service => <Pressable accessibilityRole="button" accessibilityState={{ selected: service.id === serviceId }} key={service.id} onPress={() => setServiceId(service.id)} style={[styles.serviceChip, service.id === serviceId && styles.serviceChipActive]}><Text style={[styles.serviceChipText, service.id === serviceId && styles.serviceChipTextActive]}>{service.name} · {service.durationMinutes} min{service.price == null ? '' : ` · ${service.price} ${details.currency ?? ''}`}</Text></Pressable>)}</View>
        <Text style={styles.label}>Date</Text><TextInput accessibilityLabel="Booking date" value={bookingDate} onChangeText={setBookingDate} placeholder="YYYY-MM-DD" style={styles.textInput} />
        <Text style={styles.label}>{bookingBusy ? 'Checking times…' : slots.length ? 'Available times' : 'No times available on this date'}</Text><View style={styles.serviceChips}>{slots.flatMap(slot => slot.members.map(member => ({ slot, member }))).slice(0, 40).map(({ slot, member }) => { const active = selectedSlot?.startsAt === slot.startsAt && selectedSlot.memberId === member.id; return <Pressable key={`${slot.startsAt}-${member.id}`} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setSelectedSlot({ startsAt: slot.startsAt, memberId: member.id })} style={[styles.serviceChip, active && styles.serviceChipActive]}><Text style={[styles.serviceChipText, active && styles.serviceChipTextActive]}>{new Date(slot.startsAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · {member.name}</Text></Pressable>; })}</View>
        <Text style={styles.label}>Your name</Text><TextInput accessibilityLabel="Booking name" value={name} onChangeText={setName} style={styles.textInput} />
        <Text style={styles.label}>Phone number</Text><TextInput accessibilityLabel="Booking phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={styles.textInput} />
        <Text style={styles.label}>Email <Text style={styles.optional}>(optional)</Text></Text><TextInput accessibilityLabel="Booking email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" style={styles.textInput} />
        {bookingError ? <Text accessibilityRole="alert" style={styles.bookingError}>{bookingError}</Text> : null}<Action disabled={bookingBusy || !selectedSlot || !name.trim() || !phone.trim()} label={bookingBusy ? 'Booking…' : 'Book now'} onPress={() => void book()} />
      </View> : null}

      <Text style={styles.title}>{details.services.length ? 'Ask a question' : 'Get in touch'}</Text>
      <Text style={styles.label}>Your name</Text><TextInput accessibilityLabel="Your name" editable={view.kind !== 'submitting'} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.tabInactive} style={styles.textInput} value={name} />
      <Text style={styles.label}>Phone number</Text><TextInput accessibilityLabel="Your phone number" editable={view.kind !== 'submitting'} keyboardType="phone-pad" onChangeText={setPhone} placeholder="e.g. 0771234567" placeholderTextColor={colors.tabInactive} style={styles.textInput} value={phone} />
      <Text style={styles.label}>What do you need? <Text style={styles.optional}>(optional)</Text></Text><TextInput accessibilityLabel="Service you need" editable={view.kind !== 'submitting'} onChangeText={setServiceRequested} placeholder="e.g. Kitchen sink repair" placeholderTextColor={colors.tabInactive} style={styles.textInput} value={serviceRequested} />
      <Text style={styles.label}>Message <Text style={styles.optional}>(optional)</Text></Text><TextInput accessibilityLabel="Optional message" editable={view.kind !== 'submitting'} maxLength={2000} multiline onChangeText={setMessage} placeholder="Tell them a bit more…" placeholderTextColor={colors.tabInactive} style={styles.input} value={message} />
      <Action disabled={!canSubmitContact(view, name, phone)} label={view.kind === 'submitting' ? 'Sending…' : 'Send'} onPress={() => void submit()} />
    </View> : null}
  </View><Text style={styles.footer}>Powered by Chakusa</Text></View></ScrollView></SafeAreaView>;
}

function State({ icon, title, body, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; body?: string; children?: React.ReactNode }) { return <View style={styles.state}><Ionicons name={icon} size={42} color={colors.primary} /><Text style={styles.title}>{title}</Text>{body ? <Text style={styles.body}>{body}</Text> : null}{children}</View>; }
function Row({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) { return <View style={styles.row}><Ionicons name={icon} size={16} color={colors.textSecondary} /><Text style={styles.rowText}>{text}</Text></View>; }
function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) { const [focused, setFocused] = useState(false); return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} onPress={onPress} style={({ pressed }) => [styles.action, disabled && styles.disabled, focused && styles.focused, pressed && styles.pressed]}><Text style={styles.actionText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background }, scroll: { flexGrow: 1 }, shell: { width: '100%', maxWidth: 560, alignSelf: 'center', justifyContent: 'center', padding: spacing.lg }, brand: { ...typography.micro, color: colors.primary, letterSpacing: 2, textAlign: 'center', marginBottom: spacing.md }, card: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.xxl, ...shadows.card }, form: { gap: spacing.md }, booking: { gap: spacing.sm, paddingVertical: spacing.sm }, state: { alignItems: 'center', gap: spacing.md },
  business: { ...typography.heading, color: colors.text, textAlign: 'center' }, service: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1 }, description: { ...typography.body, color: colors.text, textAlign: 'center', marginTop: spacing.xs },
  infoRows: { alignItems: 'center', gap: spacing.xxs, marginTop: spacing.xs }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs }, rowText: { ...typography.caption, color: colors.textSecondary },
  serviceChips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.xs }, serviceChip: { minHeight: 38, justifyContent: 'center', paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radius.round, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }, serviceChipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary }, serviceChipText: { ...typography.caption, color: colors.text }, serviceChipTextActive: { color: colors.primary, fontWeight: '700' },
  contactActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }, contactButton: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xxs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }, contactButtonText: { ...typography.caption, color: colors.text, fontWeight: '700' }, contactButtonWhatsApp: { backgroundColor: '#25D366', borderColor: '#25D366' }, contactButtonTextWhatsApp: { color: colors.surface },
  title: { ...typography.title, color: colors.text, textAlign: 'center', marginTop: spacing.sm }, body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' }, label: { ...typography.caption, color: colors.text }, optional: { color: colors.textSecondary },
  textInput: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text, ...typography.body }, input: { minHeight: 116, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, ...typography.body, textAlignVertical: 'top' },
  action: { minHeight: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg }, actionText: { ...typography.bodyStrong, color: colors.surface }, bookingError: { ...typography.caption, color: colors.negative }, manageHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' }, disabled: { opacity: 0.45 }, focused: { outlineStyle: 'solid', outlineWidth: 3, outlineColor: colors.primary }, pressed: { opacity: 0.72 }, footer: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg },
});
