import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { ApiError } from '../services/api';
import { useAuth } from '../state/AuthContext';
import { colors, radius, spacing, typography } from '../theme';

export function DeleteAccountScreen() {
  const { user, deleteAccount, deleteAccountWithGoogle } = useAuth(); const [password, setPassword] = useState(''); const [loading, setLoading] = useState<'password' | 'google' | null>(null); const [error, setError] = useState<string | null>(null);
  const errorText = (caught: unknown) => caught instanceof ApiError || caught instanceof Error ? caught.message : 'Unable to delete your account.';
  const submitPassword = async () => { setLoading('password'); setError(null); try { await deleteAccount(password); } catch (caught) { setError(errorText(caught)); } finally { setLoading(null); } };
  const submitGoogle = async () => { setLoading('google'); setError(null); try { await deleteAccountWithGoogle(); } catch (caught) { setError(errorText(caught)); } finally { setLoading(null); } };
  const googleLinked = user?.authProviders?.includes('GOOGLE') ?? false;
  return <Screen><View style={styles.header}><Text style={styles.title}>Delete account</Text><Text style={styles.warning}>This permanently deletes your Chakusa account, owned business, customers, leads, messages, reviews, feedback, reminders, and templates. This cannot be undone.</Text></View>{user?.hasPassword !== false ? <><View><Text style={styles.label}>Confirm your password</Text><TextInput accessibilityLabel="Confirm your password" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} /></View><PrimaryButton fullWidth disabled={Boolean(loading) || !password} label={loading === 'password' ? 'Deleting...' : 'Permanently delete account'} onPress={() => void submitPassword()} /></> : null}{googleLinked ? <SecondaryButton fullWidth icon="logo-google" disabled={Boolean(loading)} label={loading === 'google' ? 'Authenticating...' : 'Authenticate with Google and delete'} onPress={() => void submitGoogle()} /> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</Screen>;
}
const styles = StyleSheet.create({ header: { gap: spacing.sm }, title: { ...typography.title, color: colors.text }, warning: { ...typography.body, color: colors.negative }, label: { ...typography.caption, color: colors.text, marginBottom: spacing.xs }, input: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, ...typography.body, color: colors.text }, error: { ...typography.caption, color: colors.negative } });
