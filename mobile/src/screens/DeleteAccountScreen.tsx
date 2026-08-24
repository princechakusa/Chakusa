import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Alert, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { ApiError } from '../services/api';
import { useAuth } from '../state/AuthContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { deletionConfirmationCopy } from '../domain/trustSettings';
import { ownerDeletionError } from '../domain/team';

type DeleteMethod = 'password' | 'google' | 'apple';

const CONSEQUENCES = [
  'Your profile and active sign-in sessions',
  'The business records you own in Chakusa',
  'Access for team members attached to that business',
];

export function DeleteAccountScreen() {
  const { user, business, deleteAccount, deleteAccountWithGoogle, deleteAccountWithApple } = useAuth();
  const { subscription } = usePlanExperience();
  const [password, setPassword] = useState(''); const [loading, setLoading] = useState<DeleteMethod | null>(null); const [error, setError] = useState<string | null>(null);
  const errorText = (caught: unknown) => caught instanceof ApiError ? ownerDeletionError(caught.code) ?? caught.message : caught instanceof Error ? caught.message : 'Unable to delete your account.';
  const confirm = (action: () => void) => { if (loading) return; Alert.alert('Permanently delete account?', deletionConfirmationCopy(business?.name), [{ text: 'Keep my account', style: 'cancel' }, { text: 'Delete permanently', style: 'destructive', onPress: action }]); };
  const submitPassword = async () => { if (loading) return; setLoading('password'); setError(null); try { await deleteAccount(password); } catch (caught) { setError(errorText(caught)); } finally { setLoading(null); } };
  const submitGoogle = async () => { if (loading) return; setLoading('google'); setError(null); try { await deleteAccountWithGoogle(); } catch (caught) { setError(errorText(caught)); } finally { setLoading(null); } };
  const submitApple = async () => { if (loading) return; setLoading('apple'); setError(null); try { await deleteAccountWithApple(); } catch (caught) { setError(errorText(caught)); } finally { setLoading(null); } };
  const googleLinked = user?.authProviders?.includes('GOOGLE') ?? false; const appleLinked = user?.authProviders?.includes('APPLE') ?? false;
  return <Screen>
    <View style={styles.header}><View style={styles.warningIcon}><Ionicons name="warning-outline" size={28} color={colors.negative} /></View><Text style={styles.title}>Delete account</Text><Text style={styles.subtitle}>This is permanent. Review what will happen before you continue.</Text></View>
    <View style={styles.card}><Text style={styles.cardTitle}>What will be deleted</Text>{CONSEQUENCES.map(item => <View key={item} style={styles.consequence}><Ionicons name="remove-circle-outline" size={20} color={colors.negative} /><Text style={styles.consequenceText}>{item}</Text></View>)}</View>
    {subscription?.provider ? <View style={styles.storeNotice}><Ionicons name="card-outline" size={22} color={colors.text} /><Text style={styles.storeNoticeText}>Deleting Chakusa does not cancel your {subscription.provider === 'APPLE' ? 'App Store' : 'Google Play'} subscription. Cancel it in the store to stop renewal.</Text></View> : null}
    <View style={styles.authentication}><Text style={styles.sectionTitle}>Confirm it is you</Text><Text style={styles.sectionCopy}>Authenticate once more. You will receive one final confirmation before deletion.</Text>
      {user?.hasPassword !== false ? <View style={styles.passwordSection}><Text style={styles.label}>Account password</Text><TextInput accessibilityLabel="Confirm your password" autoCapitalize="none" autoCorrect={false} secureTextEntry value={password} onChangeText={setPassword} placeholder="Enter your password" placeholderTextColor={colors.textSecondary} style={styles.input} /><PrimaryButton fullWidth disabled={Boolean(loading) || !password.trim()} label={loading === 'password' ? 'Verifying…' : 'Continue with password'} onPress={() => confirm(() => void submitPassword())} /></View> : null}
      {googleLinked ? <SecondaryButton fullWidth icon="logo-google" disabled={Boolean(loading)} label={loading === 'google' ? 'Verifying…' : 'Continue with Google'} onPress={() => confirm(() => void submitGoogle())} /> : null}
      {appleLinked && Platform.OS === 'ios' ? <View style={Boolean(loading) && styles.disabled} pointerEvents={loading ? 'none' : 'auto'}><AppleAuthentication.AppleAuthenticationButton buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE} buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK} cornerRadius={radius.md} style={styles.appleButton} onPress={() => confirm(() => void submitApple())} /></View> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  </Screen>;
}
const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm }, warningIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FDECEC' }, title: { ...typography.title, color: colors.text, marginTop: spacing.xs }, subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', maxWidth: 420 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.md, ...shadows.card }, cardTitle: { ...typography.heading, color: colors.text }, consequence: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }, consequenceText: { ...typography.body, color: colors.text, flex: 1 },
  storeNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.primarySoft }, storeNoticeText: { ...typography.body, color: colors.text, flex: 1 },
  authentication: { gap: spacing.md }, sectionTitle: { ...typography.heading, color: colors.text }, sectionCopy: { ...typography.body, color: colors.textSecondary, marginTop: -spacing.sm }, passwordSection: { gap: spacing.sm }, label: { ...typography.caption, color: colors.text }, input: { minHeight: 50, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, ...typography.body, color: colors.text }, appleButton: { width: '100%', height: 50 }, disabled: { opacity: 0.45 }, error: { ...typography.caption, color: colors.negative },
});
