import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { canSubmitContact, errorViewState, PublicBusinessProfileViewState, workingHoursSummary } from '../domain/publicBusinessProfile';
import { ApiError } from '../services/api';
import { publicBusinessProfileApi } from '../services/publicBusinessProfile';
import { colors, radius, shadows, spacing, typography } from '../theme';

export function PublicBusinessProfileScreen({ slug }: { slug: string | null }) {
  const [view, setView] = useState<PublicBusinessProfileViewState>(slug ? { kind: 'loading' } : { kind: 'invalid' });
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceRequested, setServiceRequested] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!slug) { setView({ kind: 'invalid' }); return; }
    setView({ kind: 'loading' });
    try { setView({ kind: 'loaded', details: await publicBusinessProfileApi.get(slug) }); }
    catch (error) { setView(errorViewState(error instanceof ApiError ? error.kind : 'network')); }
  }, [slug]);
  useEffect(() => { void load(); }, [load]);

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

  const details = view.kind === 'loaded' || view.kind === 'submitting' || view.kind === 'submitted' ? view.details : null;
  const hours = details ? workingHoursSummary(details.workingHours) : null;

  return <SafeAreaView style={styles.page}><View style={styles.shell}><Text style={styles.brand}>CHAKUSA</Text><View style={styles.card} accessibilityLiveRegion="polite">
    {view.kind === 'loading' ? <State icon="hourglass-outline" title="Loading business page…"><ActivityIndicator color={colors.primary} accessibilityLabel="Loading business page" /></State> : null}
    {view.kind === 'network-error' ? <State icon="cloud-offline-outline" title="We couldn’t load this page" body="Check your connection and try again."><Action label="Try again" onPress={() => void load()} /></State> : null}
    {view.kind === 'invalid' ? <State icon="link-outline" title="This business page is unavailable." body="Please check the link you received." /> : null}
    {details && view.kind === 'submitted' ? <State icon="checkmark-circle-outline" title="Thanks for reaching out!" body={`${details.name} will get back to you soon.`} /> : null}
    {details && (view.kind === 'loaded' || view.kind === 'submitting') ? <View style={styles.form}>
      <Text style={styles.business}>{details.name}</Text>
      {details.industry ? <Text style={styles.service}>{details.industry}</Text> : null}
      {hours ? <Row icon="time-outline" text={hours} /> : null}
      {details.phone ? <Row icon="call-outline" text={details.phone} /> : null}
      {details.defaultServices && details.defaultServices.length > 0 ? <Text style={styles.services}>{details.defaultServices.join(' · ')}</Text> : null}
      <Text style={styles.title}>Get in touch</Text>
      <Text style={styles.label}>Your name</Text><TextInput accessibilityLabel="Your name" editable={view.kind !== 'submitting'} onChangeText={setName} placeholder="Full name" placeholderTextColor={colors.tabInactive} style={styles.textInput} value={name} />
      <Text style={styles.label}>Phone number</Text><TextInput accessibilityLabel="Your phone number" editable={view.kind !== 'submitting'} keyboardType="phone-pad" onChangeText={setPhone} placeholder="e.g. 0771234567" placeholderTextColor={colors.tabInactive} style={styles.textInput} value={phone} />
      <Text style={styles.label}>What do you need? <Text style={styles.optional}>(optional)</Text></Text><TextInput accessibilityLabel="Service you need" editable={view.kind !== 'submitting'} onChangeText={setServiceRequested} placeholder="e.g. Kitchen sink repair" placeholderTextColor={colors.tabInactive} style={styles.textInput} value={serviceRequested} />
      <Text style={styles.label}>Message <Text style={styles.optional}>(optional)</Text></Text><TextInput accessibilityLabel="Optional message" editable={view.kind !== 'submitting'} maxLength={2000} multiline onChangeText={setMessage} placeholder="Tell them a bit more…" placeholderTextColor={colors.tabInactive} style={styles.input} value={message} />
      <Action disabled={!canSubmitContact(view, name, phone)} label={view.kind === 'submitting' ? 'Sending…' : 'Send'} onPress={() => void submit()} />
    </View> : null}
  </View><Text style={styles.footer}>Powered by Chakusa</Text></View></SafeAreaView>;
}

function State({ icon, title, body, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; body?: string; children?: React.ReactNode }) { return <View style={styles.state}><Ionicons name={icon} size={42} color={colors.primary} /><Text style={styles.title}>{title}</Text>{body ? <Text style={styles.body}>{body}</Text> : null}{children}</View>; }
function Row({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) { return <View style={styles.row}><Ionicons name={icon} size={16} color={colors.textSecondary} /><Text style={styles.rowText}>{text}</Text></View>; }
function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) { const [focused, setFocused] = useState(false); return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} onPress={onPress} style={({ pressed }) => [styles.action, disabled && styles.disabled, focused && styles.focused, pressed && styles.pressed]}><Text style={styles.actionText}>{label}</Text></Pressable>; }

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: colors.background }, shell: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', justifyContent: 'center', padding: spacing.lg }, brand: { ...typography.micro, color: colors.primary, letterSpacing: 2, textAlign: 'center', marginBottom: spacing.md }, card: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.xxl, ...shadows.card }, form: { gap: spacing.md }, state: { alignItems: 'center', gap: spacing.md }, business: { ...typography.heading, color: colors.text, textAlign: 'center' }, service: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' }, services: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' }, row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs }, rowText: { ...typography.caption, color: colors.textSecondary }, title: { ...typography.title, color: colors.text, textAlign: 'center', marginTop: spacing.sm }, body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' }, label: { ...typography.caption, color: colors.text }, optional: { color: colors.textSecondary }, textInput: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, color: colors.text, ...typography.body }, input: { minHeight: 116, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, ...typography.body, textAlignVertical: 'top' }, action: { minHeight: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg }, actionText: { ...typography.bodyStrong, color: colors.surface }, disabled: { opacity: 0.45 }, focused: { outlineStyle: 'solid', outlineWidth: 3, outlineColor: colors.primary }, pressed: { opacity: 0.72 }, footer: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg } });
