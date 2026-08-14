import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { canSubmitFeedback, errorViewState, PublicFeedbackViewState, submittedViewState, viewStateFromResponse } from '../domain/publicFeedback';
import { ApiError } from '../services/api';
import { publicFeedbackApi } from '../services/publicFeedback';
import { colors, radius, shadows, spacing, typography } from '../theme';

export function PublicFeedbackScreen({ token }: { token: string | null }) {
  const [view, setView] = useState<PublicFeedbackViewState>(token ? { kind: 'loading' } : { kind: 'invalid' });
  const [rating, setRating] = useState(0);
  const [focusedRating, setFocusedRating] = useState(0);
  const [comment, setComment] = useState('');

  const load = useCallback(async () => {
    if (!token) { setView({ kind: 'invalid' }); return; }
    setView({ kind: 'loading' });
    try { setView(viewStateFromResponse(await publicFeedbackApi.get(token))); }
    catch (error) { setView(errorViewState(error instanceof ApiError ? error.kind : 'network')); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    if (!token || view.kind !== 'open' || !canSubmitFeedback(view, rating)) return;
    const details = view.details;
    setView({ kind: 'submitting', details });
    try {
      const response = await publicFeedbackApi.submit(token, rating, comment.trim() || undefined);
      setView(submittedViewState(response.state, details));
    } catch (error) {
      setView(errorViewState(error instanceof ApiError ? error.kind : 'network'));
    }
  };

  const details = view.kind === 'open' || view.kind === 'submitting' || view.kind === 'submitted' ? view.details : null;
  return <SafeAreaView style={styles.page}><View style={styles.shell}><Text style={styles.brand}>CHAKUSA</Text><View style={styles.card} accessibilityLiveRegion="polite">
    {view.kind === 'loading' ? <State icon="hourglass-outline" title="Loading feedback…"><ActivityIndicator color={colors.primary} accessibilityLabel="Loading feedback" /></State> : null}
    {view.kind === 'network-error' ? <State icon="cloud-offline-outline" title="We couldn’t load this page" body="Check your connection and try again."><Action label="Try again" onPress={() => void load()} /></State> : null}
    {view.kind === 'invalid' ? <State icon="link-outline" title="This feedback link is unavailable." body="Please check the link you received or contact the business." /> : null}
    {view.kind === 'expired' ? <State icon="time-outline" title="This feedback link has expired." body="Please contact the business if you still want to share feedback." /> : null}
    {details && view.kind === 'submitted' ? <State icon="checkmark-circle-outline" title="Thank you for your feedback." body={`Your response has been shared with ${details.business.name}.`}>{details.googleReviewLink ? <GoogleAction href={details.googleReviewLink} /> : null}</State> : null}
    {details && (view.kind === 'open' || view.kind === 'submitting') ? <View style={styles.form}>
      <Text style={styles.business}>{details.business.name}</Text>{details.serviceName ? <Text style={styles.service}>{details.serviceName}</Text> : null}<Text style={styles.title}>How was your experience?</Text>
      <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Rating from 1 to 5 stars">{[1,2,3,4,5].map(value => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: rating === value, disabled: view.kind === 'submitting' }} accessibilityLabel={`${value} star${value === 1 ? '' : 's'}`} disabled={view.kind === 'submitting'} onBlur={() => setFocusedRating(0)} onFocus={() => setFocusedRating(value)} onPress={() => setRating(value)} style={({ pressed }) => [styles.starButton, focusedRating === value && styles.focused, pressed && styles.pressed]}><Ionicons name={value <= rating ? 'star' : 'star-outline'} size={36} color={value <= rating ? colors.attention : colors.textSecondary} /></Pressable>)}</View>
      <Text style={styles.label}>Comment <Text style={styles.optional}>(optional)</Text></Text><TextInput accessibilityLabel="Optional feedback comment" editable={view.kind !== 'submitting'} maxLength={2000} multiline onChangeText={setComment} placeholder="Tell us a little more…" placeholderTextColor={colors.tabInactive} style={styles.input} value={comment} /><Text style={styles.counter}>{comment.length}/2000</Text>
      <Action disabled={!canSubmitFeedback(view, rating)} label={view.kind === 'submitting' ? 'Sending…' : 'Send feedback'} onPress={() => void submit()} />
      {details.googleReviewLink ? <GoogleAction href={details.googleReviewLink} /> : null}
    </View> : null}
  </View><Text style={styles.footer}>Feedback powered by Chakusa</Text></View></SafeAreaView>;
}

function State({ icon, title, body, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; body?: string; children?: React.ReactNode }) { return <View style={styles.state}><Ionicons name={icon} size={42} color={colors.primary} /><Text style={styles.title}>{title}</Text>{body ? <Text style={styles.body}>{body}</Text> : null}{children}</View>; }
function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) { const [focused, setFocused] = useState(false); return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} onPress={onPress} style={({ pressed }) => [styles.action, disabled && styles.disabled, focused && styles.focused, pressed && styles.pressed]}><Text style={styles.actionText}>{label}</Text></Pressable>; }
function GoogleAction({ href }: { href: string }) { const [focused, setFocused] = useState(false); return <Pressable accessibilityRole="link" accessibilityLabel="Leave a Google review" onBlur={() => setFocused(false)} onFocus={() => setFocused(true)} onPress={() => void Linking.openURL(href)} style={({ pressed }) => [styles.googleAction, focused && styles.focused, pressed && styles.pressed]}><Ionicons name="logo-google" size={20} color={colors.text} /><Text style={styles.googleText}>Leave a Google review</Text></Pressable>; }

const styles = StyleSheet.create({ page: { flex: 1, backgroundColor: colors.background }, shell: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', justifyContent: 'center', padding: spacing.lg }, brand: { ...typography.micro, color: colors.primary, letterSpacing: 2, textAlign: 'center', marginBottom: spacing.md }, card: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.xxl, ...shadows.card }, form: { gap: spacing.md }, state: { alignItems: 'center', gap: spacing.md }, business: { ...typography.heading, color: colors.text, textAlign: 'center' }, service: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' }, title: { ...typography.title, color: colors.text, textAlign: 'center' }, body: { ...typography.body, color: colors.textSecondary, textAlign: 'center' }, stars: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs }, starButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md }, focused: { outlineStyle: 'solid', outlineWidth: 3, outlineColor: colors.primary }, pressed: { opacity: 0.72 }, label: { ...typography.caption, color: colors.text }, optional: { color: colors.textSecondary }, input: { minHeight: 116, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, ...typography.body, textAlignVertical: 'top' }, counter: { ...typography.caption, color: colors.textSecondary, textAlign: 'right', marginTop: -spacing.sm }, action: { minHeight: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg }, actionText: { ...typography.bodyStrong, color: colors.surface }, disabled: { opacity: 0.45 }, googleAction: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg }, googleText: { ...typography.bodyStrong, color: colors.text }, footer: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.lg } });
