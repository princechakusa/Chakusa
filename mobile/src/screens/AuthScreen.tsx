import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '../components/BrandMark';
import { EMAIL_ENABLED, PASSWORD_RESET_EMAIL_ENABLED, PRIVACY_POLICY_URL, SOCIAL_SIGN_IN, TERMS_OF_USE_URL } from '../config';
import { AuthError, AuthInput, ExperienceSegment, NoSignInMethod, SocialButtons, type SocialProvider } from '../experience/AuthParts';
import { PressableScale, Reveal } from '../experience/motion';
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
  const [pending, setPending] = useState<SocialProvider | 'email' | null>(null);
  const busy = pending !== null;
  const socialEnabled = SOCIAL_SIGN_IN.any;

  const clearError = () => { if (error) setError(null); };

  const run = async (kind: SocialProvider | 'email', work: () => Promise<unknown>) => {
    if (busy) return;
    setError(null);
    setPending(kind);
    try {
      await work();
    } catch (caught) {
      if (caught instanceof ApiError) setError(caught.message);
      else if (caught instanceof Error && caught.message) setError(caught.message);
      else setError('Something went wrong. Please try again.');
    } finally {
      setPending(null);
    }
  };

  const submit = () => {
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    if (mode === 'register' && (!fullName.trim() || !businessName.trim())) {
      setError('Enter your name and your business name.');
      return;
    }
    return run('email', () => mode === 'login'
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
          <Reveal delay={0} distance={-16}><View style={styles.header}>
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
          </View></Reveal>

          <Reveal delay={60} distance={24}>
            <ExperienceSegment active="business" switching={experience.switching} onSwitch={experience.switchExperience} />
          </Reveal>

          <Reveal key={mode} delay={120} distance={24}><View style={styles.heading}>
            <Text style={styles.title}>{mode === 'login' ? 'Welcome back' : 'Create your workspace'}</Text>
            <Text style={styles.subtitle}>
              {mode === 'login'
                ? 'Sign in to your bookings, customers and reviews.'
                : 'Turn missed calls into follow-ups and returning customers.'}
            </Text>
          </View></Reveal>

          <AuthError message={error} />

          {auth.restoreError ? <Text style={styles.notice}>{auth.restoreError}</Text> : null}

          <Reveal delay={180} distance={24}>
            <SocialButtons pending={pending === 'email' ? null : pending} disabled={busy} onGoogle={() => void run('google', () => auth.googleSignIn())} onApple={() => void run('apple', () => auth.appleSignIn())} />
          </Reveal>

          {EMAIL_ENABLED ? (
            <Reveal delay={240} distance={24}><View style={styles.form}>
              {socialEnabled ? (
                <View style={styles.divider}>
                  <View style={styles.line} />
                  <Text style={styles.dividerText}>or with email</Text>
                  <View style={styles.line} />
                </View>
              ) : null}

              {mode === 'register' ? (
                <Reveal distance={-10} style={styles.registerFields}>
                  <AuthInput icon="person-outline" placeholder="Your name" value={fullName} onChangeText={(v) => { setFullName(v); clearError(); }} autoCapitalize="words" autoComplete="name" />
                  <AuthInput icon="briefcase-outline" placeholder="Business name" value={businessName} onChangeText={(v) => { setBusinessName(v); clearError(); }} autoCapitalize="words" />
                </Reveal>
              ) : null}

              <AuthInput icon="mail-outline" placeholder="Email address" value={email} onChangeText={(v) => { setEmail(v); clearError(); }} autoCapitalize="none" keyboardType="email-address" autoComplete="email" inputMode="email" />

              <View style={styles.passwordBlock}>
                {mode === 'login' && PASSWORD_RESET_EMAIL_ENABLED ? (
                  <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgotRow}>
                    <Text style={styles.forgot}>Forgot password?</Text>
                  </Pressable>
                ) : null}
                <AuthInput
                  icon="lock-closed-outline"
                  placeholder={mode === 'login' ? 'Password' : 'Create a password'}
                  value={password}
                  onChangeText={(v) => { setPassword(v); clearError(); }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  accessory={(
                    <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} hitSlop={8} onPress={() => setShowPassword((s) => !s)} style={styles.eye}>
                      <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={authColors.inkFaint} />
                    </Pressable>
                  )}
                />
              </View>

              <PressableScale
                testID="auth-submit"
                accessibilityRole="button"
                accessibilityLabel={mode === 'login' ? 'Sign in' : 'Create workspace'}
                disabled={busy}
                onPress={() => void submit()}
                style={[styles.cta, busy && styles.ctaPressed]}
              >
                {pending === 'email' ? <ActivityIndicator color={authColors.onCoral} /> : (
                  <>
                    <Text style={styles.ctaLabel}>{mode === 'login' ? 'Sign in' : 'Create workspace'}</Text>
                    <Ionicons name="arrow-forward" size={17} color={authColors.onCoral} />
                  </>
                )}
              </PressableScale>

              <Text accessibilityRole="button" onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); clearError(); }} style={styles.switchRow}>
                <Text style={styles.switchLead}>{mode === 'login' ? 'New to Chakusa? ' : 'Already have a workspace? '}</Text>
                <Text style={styles.switchLink}>{mode === 'login' ? 'Create one' : 'Sign in'}</Text>
              </Text>
            </View></Reveal>
          ) : !socialEnabled ? (
            <NoSignInMethod />
          ) : null}

          <Reveal delay={320}>
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
          </Reveal>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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


  heading: { gap: authSpace.xxs, marginTop: authSpace.xxs },
  title: { ...authType.display, fontSize: 27 },
  subtitle: { ...authType.body },

  form: { gap: authSpace.sm },
  registerFields: { gap: authSpace.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm },
  line: { flex: 1, height: 1, backgroundColor: authColors.line },
  dividerText: { ...authType.micro, letterSpacing: 0.4 },

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

  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xxs, marginTop: authSpace.md },
  secureText: { ...authType.micro, letterSpacing: 0.2 },

  legal: { ...authType.micro, letterSpacing: 0.1, textAlign: 'center', lineHeight: 16 },
  legalLink: { color: authColors.coral },
});
