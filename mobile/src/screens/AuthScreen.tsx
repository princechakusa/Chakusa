import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '../components/BrandMark';
import { APPLE_AUTH_ENABLED, EMAIL_ENABLED, GOOGLE_AUTH_ENABLED, PASSWORD_RESET_EMAIL_ENABLED, PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../config';
import { authColors, authRadius, authShadow, authSpace, authType } from '../experience/authTheme';
import { useExperience } from '../experience/experienceContext';
import { ApiError } from '../services/api';
import { useAuth } from '../state/AuthContext';
import { RootStackParamList } from '../types';

// PROGRAM 3: the single business-owner entry surface. Shares the premium
// entry design (experience/authTheme) with the customer auth screen: one
// welcome/login page, a switch back to the welcome screen or the customer
// app, every control wired to something real.

type Mode = 'login' | 'register';

export function AuthScreen({ navigation, route }: NativeStackScreenProps<RootStackParamList, 'Login'>) {
  const auth = useAuth();
  const experience = useExperience();

  const [mode, setMode] = useState<Mode>(route.params?.mode ?? 'login');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const socialEnabled = GOOGLE_AUTH_ENABLED || (APPLE_AUTH_ENABLED && Platform.OS === 'ios');

  const clearError = () => { if (error) setError(null); };

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (caught) {
      if (caught instanceof ApiError) setError(caught.message);
      else if (caught instanceof Error && caught.message) setError(caught.message);
      else setError('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    if (mode === 'register' && (!fullName.trim() || !businessName.trim())) {
      setError('Enter your name and your business name.');
      return;
    }
    return run(() => mode === 'login'
      ? auth.login(email.trim(), password)
      : auth.register({ email: email.trim(), password, fullName: fullName.trim(), businessName: businessName.trim() }));
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View pointerEvents="none" style={styles.glow} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to the Chakusa welcome screen"
              hitSlop={8}
              onPress={experience.openSelector}
              style={({ pressed }) => [styles.backChip, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-back" size={19} color={authColors.ink} />
            </Pressable>
            <View style={styles.brandRow}>
              <BrandMark size={22} />
              <Text style={styles.brand}>CHAKUSA</Text>
            </View>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.segment}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Switch to finding and booking services"
              disabled={experience.switching}
              onPress={() => experience.switchExperience('customer')}
              style={({ pressed }) => [styles.segmentItem, pressed && styles.pressed]}
            >
              <Text style={styles.segmentTitle}>Book &amp; track</Text>
              <Text style={styles.segmentSub}>{experience.switching ? 'Switching…' : 'Personal'}</Text>
            </Pressable>
            <View style={[styles.segmentItem, styles.segmentItemActive]}>
              <Text style={styles.segmentTitleActive}>Grow a business</Text>
              <Text style={styles.segmentSub}>Manage & earn</Text>
            </View>
          </View>

          <View style={styles.heading}>
            <Text style={styles.title}>{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</Text>
            <Text style={styles.subtitle}>
              {mode === 'login'
                ? 'Sign in to your bookings, customers and reviews.'
                : 'Turn missed calls into follow-ups and returning customers.'}
            </Text>
          </View>

          {auth.restoreError ? <Text style={styles.notice}>{auth.restoreError}</Text> : null}

          {socialEnabled ? (
            <View style={styles.social}>
              {GOOGLE_AUTH_ENABLED ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Continue with Google" disabled={busy} onPress={() => run(auth.googleSignIn)} style={({ pressed }) => [styles.socialBtn, (pressed || busy) && styles.pressed]}>
                  <Ionicons name="logo-google" size={17} color={authColors.ink} />
                  <Text style={styles.socialLabel}>Continue with Google</Text>
                </Pressable>
              ) : null}
              {APPLE_AUTH_ENABLED && Platform.OS === 'ios' ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Continue with Apple" disabled={busy} onPress={() => run(auth.appleSignIn)} style={({ pressed }) => [styles.socialBtn, (pressed || busy) && styles.pressed]}>
                  <Ionicons name="logo-apple" size={17} color={authColors.ink} />
                  <Text style={styles.socialLabel}>Continue with Apple</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {EMAIL_ENABLED ? (
            <View style={styles.form}>
              {socialEnabled ? (
                <View style={styles.divider}>
                  <View style={styles.line} />
                  <Text style={styles.dividerText}>or with email</Text>
                  <View style={styles.line} />
                </View>
              ) : null}

              {mode === 'register' ? (
                <>
                  <Field icon="person-outline">
                    <TextInput style={styles.input} placeholder="Your name" placeholderTextColor={authColors.inkFaint} value={fullName} onChangeText={(v) => { setFullName(v); clearError(); }} autoCapitalize="words" autoComplete="name" />
                  </Field>
                  <Field icon="briefcase-outline">
                    <TextInput style={styles.input} placeholder="Business name" placeholderTextColor={authColors.inkFaint} value={businessName} onChangeText={(v) => { setBusinessName(v); clearError(); }} autoCapitalize="words" />
                  </Field>
                </>
              ) : null}

              <Field icon="mail-outline">
                <TextInput style={styles.input} placeholder="Email address" placeholderTextColor={authColors.inkFaint} value={email} onChangeText={(v) => { setEmail(v); clearError(); }} autoCapitalize="none" keyboardType="email-address" autoComplete="email" inputMode="email" />
              </Field>

              <View style={styles.passwordBlock}>
                {mode === 'login' && PASSWORD_RESET_EMAIL_ENABLED ? (
                  <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgotRow}>
                    <Text style={styles.forgot}>Forgot password?</Text>
                  </Pressable>
                ) : null}
                <Field icon="lock-closed-outline">
                  <TextInput
                    style={styles.input}
                    placeholder={mode === 'login' ? 'Password' : 'Create a password'}
                    placeholderTextColor={authColors.inkFaint}
                    value={password}
                    onChangeText={(v) => { setPassword(v); clearError(); }}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  />
                  <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} hitSlop={8} onPress={() => setShowPassword((s) => !s)} style={styles.eye}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={authColors.inkFaint} />
                  </Pressable>
                </Field>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={mode === 'login' ? 'Sign in' : 'Create workspace'}
                disabled={busy}
                onPress={() => void submit()}
                style={({ pressed }) => [styles.cta, (pressed || busy) && styles.ctaPressed]}
              >
                {busy ? <ActivityIndicator color={authColors.onCoral} /> : (
                  <>
                    <Text style={styles.ctaLabel}>{mode === 'login' ? 'Sign in' : 'Create workspace'}</Text>
                    <Ionicons name="arrow-forward" size={17} color={authColors.onCoral} />
                  </>
                )}
              </Pressable>

              <Text accessibilityRole="button" onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); clearError(); }} style={styles.switchRow}>
                <Text style={styles.switchLead}>{mode === 'login' ? 'New to Chakusa? ' : 'Already have a workspace? '}</Text>
                <Text style={styles.switchLink}>{mode === 'login' ? 'Create one' : 'Sign in'}</Text>
              </Text>
            </View>
          ) : !socialEnabled ? (
            <Text style={styles.notice}>No sign-in method is configured for this build.</Text>
          ) : null}

          {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

          <View style={styles.secureRow}>
            <Ionicons name="shield-checkmark-outline" size={13} color={authColors.inkFaint} />
            <Text style={styles.secureText}>Encrypted on this device.</Text>
          </View>

          <Text style={styles.legal}>
            By continuing you agree to Chakusa{"'"}s{' '}
            <Text style={styles.legalLink} onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}>Terms of Use</Text>
            {' '}and{' '}
            <Text style={styles.legalLink} onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>Privacy Policy</Text>.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Ionicons name={icon} size={17} color={authColors.inkFaint} style={styles.fieldIcon} />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: authColors.bg },
  flex: { flex: 1 },
  glow: { position: 'absolute', top: -170, alignSelf: 'center', width: 340, height: 340, borderRadius: 340, backgroundColor: authColors.coralSoft },
  scroll: { flexGrow: 1, width: '100%', maxWidth: 460, alignSelf: 'center', paddingHorizontal: authSpace.lg, paddingTop: authSpace.xs, paddingBottom: authSpace.lg, gap: authSpace.md },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  backChip: { width: 40, height: 40, borderRadius: authRadius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.line, ...authShadow.card },
  headerSpacer: { width: 40, height: 40 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: authSpace.xs },
  brand: { fontFamily: authType.label.fontFamily, fontSize: 13, letterSpacing: 2, color: authColors.ink },
  pressed: { opacity: 0.7 },

  segment: { flexDirection: 'row', gap: authSpace.xxs, padding: authSpace.xxs, borderRadius: authRadius.lg, backgroundColor: authColors.bgSunk },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: authSpace.sm, borderRadius: authRadius.md, gap: 2 },
  segmentItemActive: { backgroundColor: authColors.surface, ...authShadow.card },
  segmentTitle: { fontFamily: authType.label.fontFamily, fontSize: 13, color: authColors.inkSoft },
  segmentTitleActive: { fontFamily: authType.label.fontFamily, fontSize: 13, color: authColors.coral },
  segmentSub: { ...authType.micro, letterSpacing: 0.2, fontSize: 10 },

  heading: { gap: authSpace.xxs, marginTop: authSpace.xxs },
  title: { ...authType.display, fontSize: 27 },
  subtitle: { ...authType.body },

  social: { gap: authSpace.xs },
  socialBtn: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs, borderRadius: authRadius.md, backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.line, ...authShadow.card },
  socialLabel: { fontFamily: authType.label.fontFamily, fontSize: 15, color: authColors.ink },

  form: { gap: authSpace.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm },
  line: { flex: 1, height: 1, backgroundColor: authColors.line },
  dividerText: { ...authType.micro, letterSpacing: 0.4 },

  field: { minHeight: 52, flexDirection: 'row', alignItems: 'center', borderRadius: authRadius.md, backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.line, paddingHorizontal: authSpace.sm },
  fieldIcon: { marginRight: authSpace.xs },
  input: { flex: 1, paddingVertical: authSpace.sm, fontFamily: authType.body.fontFamily, fontSize: 15, color: authColors.ink },
  eye: { paddingLeft: authSpace.xs, paddingVertical: authSpace.xs },

  passwordBlock: { gap: authSpace.xxs },
  forgotRow: { alignSelf: 'flex-end' },
  forgot: { ...authType.link },

  cta: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs, borderRadius: authRadius.pill, backgroundColor: authColors.coral, marginTop: authSpace.xxs, ...authShadow.cta },
  ctaPressed: { backgroundColor: authColors.coralPressed },
  ctaLabel: { fontFamily: authType.label.fontFamily, fontSize: 15, color: authColors.onCoral },

  switchRow: { textAlign: 'center', paddingVertical: authSpace.xs },
  switchLead: { ...authType.body, fontSize: 13 },
  switchLink: { fontFamily: authType.link.fontFamily, fontSize: 13, color: authColors.coral },

  notice: { ...authType.body, fontSize: 13, color: authColors.ink, textAlign: 'center' },
  error: { ...authType.body, fontSize: 13, color: authColors.danger, textAlign: 'center' },

  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xxs, marginTop: authSpace.md },
  secureText: { ...authType.micro, letterSpacing: 0.2 },

  legal: { ...authType.micro, letterSpacing: 0.1, textAlign: 'center', lineHeight: 16 },
  legalLink: { color: authColors.coral },
});
