import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton, Screen } from '../components/ui';
import { ApiError } from '../services/api';
import { useAuth } from '../state/AuthContext';
import { colors, radius, spacing, typography } from '../theme';

export function ForgotPasswordScreen() {
  const { forgotPassword } = useAuth(); const [email, setEmail] = useState(''); const [loading, setLoading] = useState(false); const [message, setMessage] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const submit = async () => { setLoading(true); setError(null); try { setMessage(await forgotPassword(email.trim())); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to request a password reset.'); } finally { setLoading(false); } };
  return <Screen><View style={styles.header}><Text style={styles.title}>Reset your password</Text><Text style={styles.copy}>Enter your account email. We will send a secure, single-use reset link.</Text></View>{message ? <Text accessibilityRole="alert" style={styles.success}>{message}</Text> : <><View><Text style={styles.label}>Email</Text><TextInput accessibilityLabel="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} style={styles.input} /></View>{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<PrimaryButton fullWidth disabled={loading || !email.trim()} label={loading ? 'Requesting...' : 'Send reset link'} onPress={() => void submit()} /></>}</Screen>;
}
const styles = StyleSheet.create({ header: { gap: spacing.xs }, title: { ...typography.title, color: colors.text }, copy: { ...typography.body, color: colors.textSecondary }, label: { ...typography.caption, color: colors.text, marginBottom: spacing.xs }, input: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, ...typography.body, color: colors.text }, success: { ...typography.body, color: colors.success }, error: { ...typography.caption, color: colors.negative } });
