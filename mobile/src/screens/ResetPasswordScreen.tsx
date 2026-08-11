import { RouteProp, useRoute } from '@react-navigation/native';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton, Screen } from '../components/ui';
import { ApiError } from '../services/api';
import { useAuth } from '../state/AuthContext';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';

export function ResetPasswordScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'ResetPassword'>>(); const { resetPassword } = useAuth(); const token = route.params?.token;
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  const submit = async () => { if (!token) { setError('This reset link is invalid. Request a new one.'); return; } if (password !== confirm) { setError('Passwords do not match.'); return; } setLoading(true); setError(null); try { await resetPassword(token, password); } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to reset your password.'); } finally { setLoading(false); } };
  return <Screen><View style={styles.header}><Text style={styles.title}>Choose a new password</Text><Text style={styles.copy}>Use at least 8 characters. Resetting your password signs out every device.</Text></View><Field label="New password" value={password} onChangeText={setPassword} /><Field label="Confirm password" value={confirm} onChangeText={setConfirm} />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}<PrimaryButton fullWidth disabled={loading || password.length < 8 || !confirm} label={loading ? 'Resetting...' : 'Reset password'} onPress={() => void submit()} /></Screen>;
}
function Field({ label, value, onChangeText }: { label: string; value: string; onChangeText: (value: string) => void }) { return <View><Text style={styles.label}>{label}</Text><TextInput accessibilityLabel={label} secureTextEntry value={value} onChangeText={onChangeText} style={styles.input} /></View>; }
const styles = StyleSheet.create({ header: { gap: spacing.xs }, title: { ...typography.title, color: colors.text }, copy: { ...typography.body, color: colors.textSecondary }, label: { ...typography.caption, color: colors.text, marginBottom: spacing.xs }, input: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, ...typography.body, color: colors.text }, error: { ...typography.caption, color: colors.negative } });
