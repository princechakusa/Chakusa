import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PRIVACY_POLICY_URL, SOCIAL_SIGN_IN, SUPPORT_EMAIL, TERMS_OF_USE_URL } from '../../config';
import { emailPasswordProblem } from '../../domain/authenticationFlow';
import { AuthError, AuthInput, AuthModeTabs, ExperienceSegment, OrDivider, SocialButtons, type SocialProvider } from '../../experience/AuthParts';
import { EntryHeader, EntryIntro, EntryBenefits, entryStyles } from '../../experience/AuthEntry';
import { PressableScale, Reveal } from '../../experience/motion';
import { authColors, authRadius, authSpace, authType } from '../../experience/authTheme';
import { useExperience } from '../../experience/experienceContext';
import { ApiError } from '../../services/api';
import { useCustomerAuth } from '../CustomerAuthContext';

// PROGRAM 3: the customer sign-in / sign-up surface. One screen, premium
// entry design (see experience/authTheme): Sign in / Create account tabs,
// labelled email + password fields, then Google / Apple as alternatives.
// Password reset mail is requested only when the server reports outbound
// email ready; otherwise the reset link points to support instead of
// pretending an email is on its way.

type Mode = 'sign-in' | 'sign-up';
const MODES = [{ value: 'sign-in', label: 'Sign in' }, { value: 'sign-up', label: 'Create account' }] as const;

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
  const [pending, setPending] = useState<SocialProvider | 'email' | 'reset' | null>(null);
  // A ref, not state: a second tap can land before the re-render that
  // would disable the button.
  const inFlight = useRef(false);
  const busy = pending !== null || auth.status === 'authenticating';
  const registering = mode === 'sign-up';
  const sessionEvent =
    auth.lastEvent === 'session-expired' ? 'Your session expired. Please sign in again.'
    : auth.lastEvent === 'account-deleted' ? 'Your account has been closed.'
    : null;

  const clearMessages = () => {
    if (error) setError(null);
    if (notice) setNotice(null);
    if (auth.lastEvent !== 'none') auth.acknowledgeEvent();
  };
  const changeMode = (next: Mode) => { setMode(next); setError(null); setNotice(null); };

  const run = async (kind: SocialProvider | 'email' | 'reset', work: () => Promise<unknown>) => {
    if (inFlight.current || auth.status === 'authenticating') return;
    inFlight.current = true;
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
      inFlight.current = false;
      setPending(null);
    }
  };

  const submitEmail = () => {
    const problem = emailPasswordProblem({ email, password, registering, fullName });
    if (problem) { setError(problem); return; }
    return run('email', () => registering
      ? auth.registerWithEmail({ email: email.trim(), password, fullName: fullName.trim() })
      : auth.loginWithEmail(email.trim(), password));
  };

  const handleForgot = () => {
    if (!auth.passwordResetEnabled) {
      setError(null);
      setNotice(`Password reset by email isn't available yet. Email ${SUPPORT_EMAIL} and we'll help you get back in.`);
      return;
    }
    if (!email.trim()) { setNotice(null); setError('Enter your email above, then tap Forgot password.'); return; }
    return run('reset', async () => {
      const message = await auth.forgotPassword(email.trim());
      setNotice(message || 'If that email has an account, we have sent instructions to it. Check your inbox.');
    });
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={entryStyles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
        <ScrollView
          contentContainerStyle={entryStyles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <EntryHeader business={false} onBack={experience.openSelector} />

          <Reveal delay={60} distance={24}>
            <ExperienceSegment active="customer" switching={experience.switching} onSwitch={experience.switchExperience} />
          </Reveal>

          <EntryIntro business={false} registering={registering} compact={true} />

          <Reveal delay={140} distance={24}>
            <View style={entryStyles.signInCard}>
              <AuthModeTabs value={mode} options={MODES} disabled={busy} onChange={changeMode} />

              {sessionEvent ? <Text style={styles.notice}>{sessionEvent}</Text> : null}
              <AuthError message={error} />
              {notice ? <Text accessibilityRole="alert" style={styles.noticeOk}>{notice}</Text> : null}

              {registering ? (
                <AuthInput label="Full name" icon="person-outline" placeholder="Jane Doe" value={fullName} onChangeText={(v) => { setFullName(v); clearMessages(); }} autoCapitalize="words" autoComplete="name" textContentType="name" returnKeyType="next" editable={!busy} />
              ) : null}

              <AuthInput label="Email" icon="mail-outline" placeholder="you@example.com" value={email} onChangeText={(v) => { setEmail(v); clearMessages(); }} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" inputMode="email" returnKeyType="next" editable={!busy} />

              <View style={styles.passwordBlock}>
                <AuthInput
                  label="Password"
                  icon="lock-closed-outline"
                  placeholder={registering ? 'At least 8 characters' : 'Your password'}
                  value={password}
                  onChangeText={(v) => { setPassword(v); clearMessages(); }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  textContentType={registering ? 'newPassword' : 'password'}
                  returnKeyType="go"
                  onSubmitEditing={() => void submitEmail()}
                  editable={!busy}
                  accessory={(
                    <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} hitSlop={10} onPress={() => setShowPassword((s) => !s)} style={styles.eye}>
                      <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={authColors.inkFaint} />
                    </Pressable>
                  )}
                />
                {registering ? (
                  <Text style={styles.hint}>Use at least 8 characters.</Text>
                ) : (
                  <Pressable accessibilityRole="button" disabled={busy} hitSlop={8} onPress={() => void handleForgot()} style={styles.forgotRow}>
                    {pending === 'reset' ? <ActivityIndicator size="small" color="#2F5444" /> : <Text style={styles.forgot}>Forgot password?</Text>}
                  </Pressable>
                )}
              </View>

              <PressableScale
                testID="auth-submit"
                accessibilityRole="button"
                accessibilityLabel={registering ? 'Create account' : 'Sign in'}
                accessibilityState={{ disabled: busy, busy: pending === 'email' }}
                disabled={busy}
                onPress={() => void submitEmail()}
                style={[styles.cta, busy && styles.ctaPressed]}
              >
                {pending === 'email' ? <ActivityIndicator color={authColors.onCoral} /> : (
                  <>
                    <Text style={styles.ctaLabel}>{registering ? 'Create account' : 'Sign in'}</Text>
                    <Ionicons name="arrow-forward" size={17} color={authColors.onCoral} />
                  </>
                )}
              </PressableScale>

              <Text accessibilityRole="button" onPress={() => { if (!busy) changeMode(registering ? 'sign-in' : 'sign-up'); }} style={styles.switchRow}>
                <Text style={styles.switchLead}>{registering ? 'Already have an account? ' : 'New here? '}</Text>
                <Text style={styles.switchLink}>{registering ? 'Sign in' : 'Create an account'}</Text>
              </Text>

              {SOCIAL_SIGN_IN.any ? (
                <>
                  <OrDivider label="or continue with" />
                  <SocialButtons pending={pending === 'google' || pending === 'apple' ? pending : null} disabled={busy} onGoogle={() => void run('google', auth.signInWithGoogle)} onApple={() => void run('apple', auth.signInWithApple)} />
                </>
              ) : null}
            </View>
          </Reveal>

          <EntryBenefits business={false} />

          <View>
            <View style={entryStyles.secureRow}>
              <Ionicons name="shield-checkmark-outline" size={13} color={authColors.inkFaint} />
              <Text style={entryStyles.secureText}>Your session is encrypted on this device.</Text>
            </View>
            <Text style={entryStyles.legal}>
              By continuing you agree to Chakusa{"'"}s{' '}
              <Text accessibilityRole="link" style={entryStyles.legalLink} onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}>Terms of Service</Text>
              {' '}and{' '}
              <Text accessibilityRole="link" style={entryStyles.legalLink} onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}>Privacy Policy</Text>.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  eye: { paddingLeft: authSpace.xs, paddingVertical: authSpace.xs },
  passwordBlock: { gap: authSpace.xs },
  forgotRow: { alignSelf: 'flex-end', minHeight: 32, justifyContent: 'center' },
  forgot: { ...authType.link, color: '#2F5444' },
  hint: { ...authType.body, fontSize: 12, lineHeight: 17, color: '#718075' },
  cta: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs, borderRadius: authRadius.pill, backgroundColor: '#182F2D' },
  ctaPressed: { backgroundColor: '#304D40' },
  ctaLabel: { fontFamily: authType.label.fontFamily, fontSize: 15, color: authColors.onCoral },
  switchRow: { textAlign: 'center', paddingVertical: authSpace.xxs },
  switchLead: { ...authType.body, fontSize: 13 },
  switchLink: { fontFamily: authType.link.fontFamily, fontSize: 13, color: '#2F5444' },
  notice: { ...authType.body, fontSize: 13, color: authColors.ink, textAlign: 'center' },
  noticeOk: { ...authType.body, fontSize: 13, lineHeight: 19, color: '#2F5444', textAlign: 'center' },
});
