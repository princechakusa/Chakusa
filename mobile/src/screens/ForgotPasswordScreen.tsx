import { useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton, Screen } from '../components/ui';
import { ApiError } from '../services/api';
import { useAuth } from '../state/AuthContext';
import { colors, radius, spacing, typography } from '../theme';
import { PASSWORD_RESET_EMAIL_ENABLED, SUPPORT_EMAIL } from '../config';
import { passwordResetCopy } from '../domain/mobileProduction';

export function ForgotPasswordScreen() {
  const { forgotPassword } = useAuth(); const [email, setEmail] = useState(''); const [loading, setLoading] = useState(false); const [message, setMessage] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const submissionActive = useRef(false);
  const submit = async () => { if (submissionActive.current) return; submissionActive.current = true; setLoading(true); setError(null); try { setMessage(await forgotPassword(email.trim())); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to request a password reset.'); } finally { submissionActive.current = false; setLoading(false); } };
  return <Screen><View style={styles.header}><Text style={styles.title}>Reset your password</Text><Text style={styles.copy}>{passwordResetCopy(PASSWORD_RESET_EMAIL_ENABLED)}</Text>{!PASSWORD_RESET_EMAIL_ENABLED ? <Text style={styles.copy}>Contact {SUPPORT_EMAIL} for account-access help.</Text> : null}</View>{PASSWORD_RESET_EMAIL_ENABLED ? message ? <Text accessibilityRole="alert" style={styles.success}>{message}</Text> : <><View><Text style={styles.label}>Email</Text><TextInput accessibilityLabel="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} style={styles.input} /></View>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<PrimaryButton fullWidth disabled={loading || !email.trim()} label={loading ? 'Requesting...' : 'Send reset link'} onPress={() => void submit()} /></> : null}</Screen>;
}
const styles = StyleSheet.create({ header: { gap: spacing.xs }, title: { ...typography.title, color: colors.text }, copy: { ...typography.body, color: colors.textSecondary }, label: { ...typography.caption, color: colors.text, marginBottom: spacing.xs }, input: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, ...typography.body, color: colors.text }, success: { ...typography.body, color: colors.success }, error: { ...typography.caption, color: colors.negative } });
