import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton, Screen, SecondaryButton } from '../../components/ui';
import { APPLE_AUTH_ENABLED, GOOGLE_AUTH_ENABLED } from '../../config';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { useCustomerAuth } from '../CustomerAuthContext';

// PROGRAM 2 LOOP 7: the customer sign-in / sign-up screen. Google + Apple
// are the primary paths. Email/password is shown only when EMAIL_ENABLED
// is set for the build (it is false in production), mirroring the business
// AuthForm.

type Mode = 'sign-in' | 'sign-up';

export function CustomerAuthScreen() {
  const auth = useCustomerAuth();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const busy = auth.status === 'authenticating';

  const wrap = async (work: () => Promise<unknown>) => {
    setError(null);
    try { await work(); }
    catch (caught) {
      if (caught instanceof ApiError) setError(caught.message);
      else if (caught instanceof Error && caught.message) setError(caught.message);
      else setError('Something went wrong. Please try again.');
    }
  };

  const submitEmail = () => wrap(() => mode === 'sign-in'
    ? auth.loginWithEmail(email.trim(), password)
    : auth.registerWithEmail({ email: email.trim(), password, fullName: fullName.trim() }));

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.mark}><Ionicons name="sparkles" size={26} color={colors.primary} /></View>
        <Text style={styles.title}>Chakusa</Text>
        <Text style={styles.subtitle}>Book trusted local businesses, keep every appointment in one place.</Text>
      </View>

      {auth.lastEvent === 'session-expired' ? <Text style={styles.notice}>Your session expired. Please sign in again.</Text> : null}
      {auth.lastEvent === 'account-deleted' ? <Text style={styles.notice}>Your account has been closed. Sorry to see you go.</Text> : null}

      <View style={styles.providers}>
        {GOOGLE_AUTH_ENABLED ? (
          <SecondaryButton fullWidth icon="logo-google" label="Continue with Google" disabled={busy} onPress={() => wrap(auth.signInWithGoogle)} />
        ) : null}
        {APPLE_AUTH_ENABLED && Platform.OS === 'ios' ? (
          <SecondaryButton fullWidth icon="logo-apple" label="Continue with Apple" disabled={busy} onPress={() => wrap(auth.signInWithApple)} />
        ) : null}
        {!GOOGLE_AUTH_ENABLED && !(APPLE_AUTH_ENABLED && Platform.OS === 'ios') && !auth.emailAuthEnabled ? (
          <Text style={styles.notice}>No sign-in method is configured for this build.</Text>
        ) : null}
      </View>

      {auth.emailAuthEnabled ? (
        <View style={styles.form}>
          <View style={styles.divider}><View style={styles.line} /><Text style={styles.dividerText}>or with email</Text><View style={styles.line} /></View>
          {mode === 'sign-up' ? (
            <TextInput style={styles.input} placeholder="Full name" placeholderTextColor={colors.textSecondary} value={fullName} onChangeText={setFullName} autoCapitalize="words" />
          ) : null}
          <TextInput style={styles.input} placeholder="Email" placeholderTextColor={colors.textSecondary} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
          <TextInput style={styles.input} placeholder="Password" placeholderTextColor={colors.textSecondary} value={password} onChangeText={setPassword} secureTextEntry />
          <PrimaryButton fullWidth label={mode === 'sign-in' ? 'Sign in' : 'Create account'} disabled={busy} onPress={submitEmail} />
          <Text style={styles.switch} onPress={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setError(null); }}>
            {mode === 'sign-in' ? 'New to Chakusa? Create an account' : 'Already have an account? Sign in'}
          </Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Text style={styles.legal}>By continuing you agree to the Chakusa Terms of Service and Privacy Policy.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.xxl },
  mark: { width: 56, height: 56, borderRadius: radius.xl, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xs },
  title: { ...typography.title, color: colors.text },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', paddingHorizontal: spacing.md },
  providers: { gap: spacing.sm, marginTop: spacing.lg },
  form: { gap: spacing.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.sm },
  line: { flex: 1, height: 1, backgroundColor: colors.divider },
  dividerText: { ...typography.caption, color: colors.textSecondary },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, ...typography.body, color: colors.text },
  switch: { ...typography.caption, color: colors.primary, textAlign: 'center', paddingVertical: spacing.xs },
  notice: { ...typography.caption, color: colors.text, textAlign: 'center' },
  error: { ...typography.caption, color: colors.negative, textAlign: 'center' },
  legal: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.md },
});
