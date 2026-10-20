import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useConfirmSheet } from '../../components/ConfirmSheet';
import { Screen } from '../../components/ui';
import { ownerDeletionError } from '../../domain/team';
import { authColors, authFont, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { useCustomerAuth } from '../CustomerAuthContext';

type Method = 'password' | 'google' | 'apple';

const DELETED = [
  'Your profile, photo and preferences',
  'Your bookings history, favourites, rewards and messages',
  'Every signed-in device, and your Google or Apple sign-in link',
];

// Store-required, permanent account deletion. Confirms identity again
// (password, Google or Apple, whichever the account uses), then asks Yes/No.
export function CustomerDeleteAccountScreen() {
  const navigation = useNavigation();
  const { user, deleteAccountWithPassword, deleteAccountWithGoogle, deleteAccountWithApple } = useCustomerAuth();
  const { confirm, sheet } = useConfirmSheet();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<Method | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providers = user?.linkedProviders ?? [];
  const hasPassword = user?.hasPassword ?? true;
  const google = providers.includes('GOOGLE');
  const apple = providers.includes('APPLE') && Platform.OS === 'ios';

  const run = async (method: Method, action: () => Promise<unknown>) => {
    if (busy) return;
    const yes = await confirm({
      title: 'Delete your account?',
      message: 'Everything listed will be erased for good. This cannot be undone.',
      confirmLabel: 'Delete permanently',
      cancelLabel: 'Keep my account',
      destructive: true,
      icon: 'trash-outline',
    });
    if (!yes) return;
    setBusy(method);
    setError(null);
    try { await action(); }
    catch (caught) {
      setError(caught instanceof ApiError
        ? ownerDeletionError(caught.code) ?? (caught.code === 'AUTH_REAUTHENTICATION_REQUIRED' || caught.code === 'AUTH_INVALID_CREDENTIALS' ? 'That did not match your account. Try again.' : caught.message)
        : 'We could not delete your account. Please try again.');
    } finally { setBusy(null); }
  };

  return (
    <Screen backgroundColor={authColors.bg}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} onPress={() => navigation.goBack()} style={styles.back}>
        <Ionicons name="chevron-back" size={22} color={authColors.ink} />
      </Pressable>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="trash-outline" size={26} color={authColors.danger} /></View>
        <Text style={styles.title}>Delete account</Text>
        <Text style={styles.subtitle}>{user?.email}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>WHAT GETS DELETED</Text>
        {DELETED.map((line) => (
          <View key={line} style={styles.item}>
            <Ionicons name="close-circle" size={18} color={authColors.danger} />
            <Text style={styles.itemText}>{line}</Text>
          </View>
        ))}
        <Text style={styles.note}>Invoices a business has issued to you may be kept by that business where the law requires it.</Text>
      </View>

      <Text style={styles.sectionLabel}>CONFIRM IT'S YOU</Text>
      <View style={styles.card}>
        {hasPassword ? (
          <View style={styles.passwordBlock}>
            <View style={styles.inputWrap}>
              <Ionicons name="lock-closed-outline" size={18} color={authColors.inkFaint} />
              <TextInput accessibilityLabel="Your password" autoCapitalize="none" autoCorrect={false} secureTextEntry value={password} onChangeText={setPassword} placeholder="Your password" placeholderTextColor={authColors.inkFaint} style={styles.input} />
            </View>
            <Pressable accessibilityRole="button" disabled={Boolean(busy) || !password.trim()} onPress={() => void run('password', () => deleteAccountWithPassword(password))} style={({ pressed }) => [styles.danger, (Boolean(busy) || !password.trim()) && styles.disabled, pressed && styles.pressed]}>
              {busy === 'password' ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.dangerText}>Delete with password</Text>}
            </Pressable>
          </View>
        ) : null}
        {google ? (
          <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => void run('google', deleteAccountWithGoogle)} style={({ pressed }) => [styles.provider, Boolean(busy) && styles.disabled, pressed && styles.pressed]}>
            {busy === 'google' ? <ActivityIndicator color={authColors.ink} /> : <><Ionicons name="logo-google" size={18} color={authColors.ink} /><Text style={styles.providerText}>Confirm with Google</Text></>}
          </Pressable>
        ) : null}
        {apple ? (
          <View pointerEvents={busy ? 'none' : 'auto'} style={Boolean(busy) && styles.disabled}>
            <AppleAuthentication.AppleAuthenticationButton buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE} buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK} cornerRadius={authRadius.pill} style={styles.appleButton} onPress={() => void run('apple', deleteAccountWithApple)} />
          </View>
        ) : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      </View>
      {sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.line },
  hero: { alignItems: 'center', marginTop: authSpace.sm, marginBottom: authSpace.lg },
  heroIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FDECEC', alignItems: 'center', justifyContent: 'center', marginBottom: authSpace.sm },
  title: { ...authType.title },
  subtitle: { ...authType.body, marginTop: 2 },
  card: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, padding: authSpace.md, gap: authSpace.sm, ...authShadow.card },
  cardLabel: { ...authType.micro },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: authSpace.xs },
  itemText: { ...authType.body, color: authColors.ink, flex: 1 },
  note: { ...authType.body, fontSize: 12, lineHeight: 17, marginTop: authSpace.xxs },
  sectionLabel: { ...authType.micro, marginTop: authSpace.lg, marginBottom: authSpace.xs },
  passwordBlock: { gap: authSpace.sm },
  inputWrap: { minHeight: 52, borderRadius: authRadius.md, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.bg, paddingHorizontal: authSpace.sm, flexDirection: 'row', alignItems: 'center', gap: authSpace.xs },
  input: { flex: 1, minHeight: 50, fontFamily: authFont.body, fontSize: 15, color: authColors.ink },
  danger: { minHeight: 52, borderRadius: authRadius.pill, backgroundColor: authColors.danger, alignItems: 'center', justifyContent: 'center' },
  dangerText: { fontFamily: authFont.bodySemibold, fontSize: 15, color: '#FFFFFF' },
  provider: { minHeight: 52, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs },
  providerText: { fontFamily: authFont.bodySemibold, fontSize: 15, color: authColors.ink },
  appleButton: { width: '100%', height: 52 },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  error: { ...authType.body, fontSize: 13, color: authColors.danger },
});
