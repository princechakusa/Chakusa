import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '../../components/BrandMark';
import { PRIVACY_POLICY_URL, SOCIAL_SIGN_IN, TERMS_OF_USE_URL } from '../../config';
import { AuthError, AuthInput, ExperienceSegment, NoSignInMethod, SocialButtons, type SocialProvider } from '../../experience/AuthParts';
import { PressableScale, Reveal } from '../../experience/motion';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { useExperience } from '../../experience/experienceContext';
import { ApiError } from '../../services/api';
import { useCustomerAuth } from '../CustomerAuthContext';

// PROGRAM 3: the customer sign-in / sign-up surface. One screen, premium
// entry design (see experience/authTheme). Every control is wired: Google
// / Apple, email + password, forgot password, the website legal pages, and
// the switch back to the welcome screen or the business app.

type Mode = 'sign-in' | 'sign-up';

export function CustomerAuthScreen() {
  const auth = useCustomerAuth();
  const experience = useExperience();

  const [mode, setMode] = useState<Mode>('sign-in');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [pending, setPending] = useState<SocialProvider | 'email' | null>(null);
  const busy = pending !== null || auth.status === 'authenticating';
  const socialEnabled = SOCIAL_SIGN_IN.any;
  const sessionEvent =
    auth.lastEvent === 'session-expired' ? 'Your session expired. Please sign in again.'
    : auth.lastEvent === 'account-deleted' ? 'Your account has been closed.'
    : null;

  const clearMessages = () => {
    if (error) setError(null);
    if (notice) setNotice(null);
    if (auth.lastEvent !== 'none') auth.acknowledgeEvent();
  };

  const run = async (kind: SocialProvider | 'email', work: () => Promise<unknown>) => {
    if (busy) return;
    setError(null);
    setNotice(null);
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

  const submitEmail = () => {
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    if (mode === 'sign-up' && !fullName.trim()) { setError('Enter your name.'); return; }
    return run('email', () => mode === 'sign-in'
      ? auth.loginWithEmail(email.trim(), password)
      : auth.registerWithEmail({ email: email.trim(), password, fullName: fullName.trim() }));
  };

  const handleForgot = async () => {
    if (!email.trim()) { setError('Enter your email above first.'); return; }
    setError(null);
    try {
      const message = await auth.forgotPassword(email.trim());
      setNotice(message || 'If that email has an account, a reset link is on its way.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not start a password reset.');
    }
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
            <ExperienceSegment active="customer" switching={experience.switching} onSwitch={experience.switchExperience} />
          </Reveal>

          <Reveal key={mode} delay={120} distance={24}><View style={styles.heading}>
            <Text style={styles.title}>{mode === 'sign-in' ? 'Welcome back' : 'Create your account'}</Text>
            <Text style={styles.subtitle}>
              {mode === 'sign-in'
                ? 'Sign in to your bookings, rewards and saved businesses.'
                : 'Book trusted local businesses, all in one place.'}
            </Text>
          </View></Reveal>

          {sessionEvent ? <Text style={styles.notice}>{sessionEvent}</Text> : null}
          <AuthError message={error} />
          {notice ? <Text style={styles.noticeOk}>{notice}</Text> : null}

          <Reveal delay={180} distance={24}>
            <SocialButtons pending={pending === 'email' ? null : pending} disabled={busy} onGoogle={() => void run('google', auth.signInWithGoogle)} onApple={() => void run('apple', auth.signInWithApple)} />
          </Reveal>

          {auth.emailAuthEnabled ? (
            <Reveal delay={240} distance={24}><View style={styles.form}>
              {socialEnabled ? (
                <View style={styles.divider}>
                  <View style={styles.line} />
                  <Text style={styles.dividerText}>or with email</Text>
                  <View style={styles.line} />
                </View>
              ) : null}

              {mode === 'sign-up' ? (
                <Reveal distance={-10}>
                  <AuthInput icon="person-outline" placeholder="Full name" value={fullName} onChangeText={(v) => { setFullName(v); clearMessages(); }} autoCapitalize="words" autoComplete="name" />
                </Reveal>
              ) : null}

              <AuthInput icon="mail-outline" placeholder="Email address" value={email} onChangeText={(v) => { setEmail(v); clearMessages(); }} autoCapitalize="none" keyboardType="email-address" autoComplete="email" inputMode="email" />

              <View style={styles.passwordBlock}>
                {mode === 'sign-in' ? (
                  <Pressable accessibilityRole="button" onPress={() => void handleForgot()} style={styles.forgotRow}>
                    <Text style={styles.forgot}>Forgot password?</Text>
                  </Pressable>
                ) : null}
                <AuthInput
                  icon="lock-closed-outline"
                  placeholder={mode === 'sign-in' ? 'Password' : 'Create a password'}
                  value={password}
                  onChangeText={(v) => { setPassword(v); clearMessages(); }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
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
                accessibilityLabel={mode === 'sign-in' ? 'Sign in' : 'Create account'}
                disabled={busy}
                onPress={() => void submitEmail()}
                style={[styles.cta, busy && styles.ctaPressed]}
              >
                {pending === 'email' ? <ActivityIndicator color={authColors.onCoral} /> : (
                  <>
                    <Text style={styles.ctaLabel}>{mode === 'sign-in' ? 'Sign in' : 'Create account'}</Text>
                    <Ionicons name="arrow-forward" size={17} color={authColors.onCoral} />
                  </>
                )}
              </PressableScale>

              <Text accessibilityRole="button" onPress={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); clearMessages(); }} style={styles.switchRow}>
                <Text style={styles.switchLead}>{mode === 'sign-in' ? 'New to Chakusa? ' : 'Already have an account? '}</Text>
                <Text style={styles.switchLink}>{mode === 'sign-in' ? 'Create an account' : 'Sign in'}</Text>
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
            <Text style={styles.legalLink} onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}>Terms of Service</Text>
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
  divider: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm },
  line: { flex: 1, height: 1, backgroundColor: authColors.line },
  dividerText: { ...authType.micro, letterSpacing: 0.4, textTransform: 'lowercase' },

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
  noticeOk: { ...authType.body, fontSize: 13, color: authColors.positive, textAlign: 'center' },

  secureRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xxs, marginTop: authSpace.md },
  secureText: { ...authType.micro, letterSpacing: 0.2 },

  legal: { ...authType.micro, letterSpacing: 0.1, textAlign: 'center', lineHeight: 16 },
  legalLink: { color: authColors.coral },
});
