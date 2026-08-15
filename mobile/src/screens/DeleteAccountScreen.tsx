import { useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Alert, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { ApiError } from '../services/api';
import { useAuth } from '../state/AuthContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { colors, radius, spacing, typography } from '../theme';
import { deletionConfirmationCopy } from '../domain/trustSettings';
import { ownerDeletionError } from '../domain/team';

export function DeleteAccountScreen() {
  const { user, business, deleteAccount, deleteAccountWithGoogle, deleteAccountWithApple } = useAuth();
  const { subscription } = usePlanExperience();
  const [password, setPassword] = useState(''); const [loading, setLoading] = useState<'password'|'google'|'apple'|null>(null); const [error, setError] = useState<string | null>(null);
  const errorText = (caught: unknown) => caught instanceof ApiError ? ownerDeletionError(caught.code) ?? caught.message : caught instanceof Error ? caught.message : 'Unable to delete your account.';
  const confirm = (action: () => void) => { if (loading) return; Alert.alert('Final confirmation', deletionConfirmationCopy(business?.name), [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: action }]); };
  const submitPassword = async () => { if (loading) return; setLoading('password'); setError(null); try { await deleteAccount(password); } catch (caught) { setError(errorText(caught)); } finally { setLoading(null); } };
  const submitGoogle = async () => { if (loading) return; setLoading('google'); setError(null); try { await deleteAccountWithGoogle(); } catch (caught) { setError(errorText(caught)); } finally { setLoading(null); } };
  const submitApple = async () => { if (loading) return; setLoading('apple'); setError(null); try { await deleteAccountWithApple(); } catch (caught) { setError(errorText(caught)); } finally { setLoading(null); } };
  const googleLinked = user?.authProviders?.includes('GOOGLE') ?? false; const appleLinked = user?.authProviders?.includes('APPLE') ?? false;
  return <Screen><View style={styles.header}><Text style={styles.title}>Delete account</Text><Text style={styles.warning}>This deletes your Chakusa account and data owned through it, including its business records. This cannot be undone.</Text>{subscription?.provider ? <Text style={styles.subscriptionWarning}>Deleting Chakusa does not cancel your {subscription.provider === 'APPLE' ? 'App Store' : 'Google Play'} subscription. Cancel it through the store if you no longer want it to renew.</Text> : null}</View>{user?.hasPassword !== false ? <><View><Text style={styles.label}>Confirm your password</Text><TextInput accessibilityLabel="Confirm your password" secureTextEntry value={password} onChangeText={setPassword} style={styles.input} /></View><PrimaryButton fullWidth disabled={Boolean(loading) || !password} label={loading === 'password' ? 'Deleting…' : 'Permanently delete account'} onPress={() => confirm(() => void submitPassword())} /></> : null}{googleLinked ? <SecondaryButton fullWidth icon="logo-google" disabled={Boolean(loading)} label={loading === 'google' ? 'Authenticating…' : 'Authenticate with Google and delete'} onPress={() => confirm(() => void submitGoogle())} /> : null}{appleLinked && Platform.OS === 'ios' ? <View style={Boolean(loading) && styles.disabled} pointerEvents={loading ? 'none' : 'auto'}><AppleAuthentication.AppleAuthenticationButton buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE} buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK} cornerRadius={radius.md} style={styles.appleButton} onPress={() => confirm(() => void submitApple())} /></View> : null}{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</Screen>;
}
const styles = StyleSheet.create({ header: { gap: spacing.sm }, title: { ...typography.title, color: colors.text }, warning: { ...typography.body, color: colors.negative }, subscriptionWarning: { ...typography.bodyStrong, color: colors.text }, label: { ...typography.caption, color: colors.text, marginBottom: spacing.xs }, input: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, ...typography.body, color: colors.text }, appleButton: { width: '100%', height: 50 }, disabled: { opacity: 0.45 }, error: { ...typography.caption, color: colors.negative } });
