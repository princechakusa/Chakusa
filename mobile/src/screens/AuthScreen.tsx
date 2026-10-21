import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PRIVACY_POLICY_URL, SOCIAL_SIGN_IN, TERMS_OF_USE_URL } from '../config';
import { emailPasswordProblem } from '../domain/authenticationFlow';
import { AuthError, AuthInput, AuthModeTabs, ExperienceSegment, OrDivider, SocialButtons, type SocialProvider } from '../experience/AuthParts';
import { EntryHeader, EntryIntro, EntryBenefits, entryStyles } from '../experience/AuthEntry';
import { PressableScale, Reveal } from '../experience/motion';
import { authColors, authRadius, authSpace, authType } from '../experience/authTheme';
import { useExperience } from '../experience/experienceContext';
import { ApiError } from '../services/api';
import { useAuth } from '../state/AuthContext';
import { RootStackParamList } from '../types';

// PROGRAM 3: the single business-owner entry surface. Shares the premium
// entry design (experience/authTheme) with the customer auth screen:
// Sign in / Create account tabs, labelled email + password fields, then
// Google / Apple as alternatives. Every control is wired to the real
// AuthContext handlers; the server stays authoritative for validation.

type Mode = 'login' | 'register';
const MODES = [{ value: 'login', label: 'Sign in' }, { value: 'register', label: 'Create account' }] as const;

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
  // A ref, not state: a second tap can land before the re-render that
  // would disable the button.
  const inFlight = useRef(false);
  const busy = pending !== null;
  const registering = mode === 'register';

  const clearError = () => { if (error) setError(null); };
  const changeMode = (next: Mode) => { setMode(next); setError(null); };

  const run = async (kind: SocialProvider | 'email', work: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
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

  const submit = () => {
    const problem = emailPasswordProblem({ email, password, registering, fullName, businessName, needsBusinessName: true });
    if (problem) { setError(problem); return; }
    return run('email', () => registering
      ? auth.register({ email: email.trim(), password, fullName: fullName.trim(), businessName: businessName.trim() })
      : auth.login(email.trim(), password));
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={entryStyles.safe}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <ScrollView
          contentContainerStyle={entryStyles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
        >
          <EntryHeader business={true} onBack={experience.openSelector} />

          <Reveal delay={60} distance={24}>
            <ExperienceSegment active="business" switching={experience.switching} onSwitch={experience.switchExperience} />
          </Reveal>

          <EntryIntro business={true} registering={registering} compact={true} />

          <Reveal delay={140} distance={24}>
            <View style={entryStyles.signInCard}>
              <AuthModeTabs value={mode} options={MODES} disabled={busy} onChange={changeMode} />

              <AuthError message={error} />
              {auth.restoreError ? <Text style={styles.notice}>{auth.restoreError}</Text> : null}

              {registering ? (
                <>
                  <AuthInput label="Your name" icon="person-outline" placeholder="Jane Doe" value={fullName} onChangeText={(v) => { setFullName(v); clearError(); }} autoCapitalize="words" autoComplete="name" textContentType="name" returnKeyType="next" editable={!busy} />
                  <AuthInput label="Business name" icon="briefcase-outline" placeholder="Your business" value={businessName} onChangeText={(v) => { setBusinessName(v); clearError(); }} autoCapitalize="words" autoComplete="organization" textContentType="organizationName" returnKeyType="next" editable={!busy} />
                </>
              ) : null}

              <AuthInput label="Email" icon="mail-outline" placeholder="you@example.com" value={email} onChangeText={(v) => { setEmail(v); clearError(); }} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" inputMode="email" returnKeyType="next" editable={!busy} />

              <View style={styles.passwordBlock}>
                <AuthInput
                  label="Password"
                  icon="lock-closed-outline"
                  placeholder={registering ? 'At least 8 characters' : 'Your password'}
                  value={password}
                  onChangeText={(v) => { setPassword(v); clearError(); }}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  textContentType={registering ? 'newPassword' : 'password'}
                  returnKeyType="go"
                  onSubmitEditing={() => void submit()}
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
                  <Pressable accessibilityRole="button" disabled={busy} hitSlop={8} onPress={() => navigation.navigate('ForgotPassword')} style={styles.forgotRow}>
                    <Text style={styles.forgot}>Forgot password?</Text>
                  </Pressable>
                )}
              </View>

              <PressableScale
                testID="auth-submit"
                accessibilityRole="button"
                accessibilityLabel={registering ? 'Create account' : 'Sign in'}
                accessibilityState={{ disabled: busy, busy: pending === 'email' }}
                disabled={busy}
                onPress={() => void submit()}
                style={[styles.cta, busy && styles.ctaPressed]}
              >
                {pending === 'email' ? <ActivityIndicator color={authColors.onCoral} /> : (
                  <>
                    <Text style={styles.ctaLabel}>{registering ? 'Create account' : 'Sign in'}</Text>
                    <Ionicons name="arrow-forward" size={17} color={authColors.onCoral} />
                  </>
                )}
              </PressableScale>

              <Text accessibilityRole="button" onPress={() => { if (!busy) changeMode(registering ? 'login' : 'register'); }} style={styles.switchRow}>
                <Text style={styles.switchLead}>{registering ? 'Already have an account? ' : 'New here? '}</Text>
                <Text style={styles.switchLink}>{registering ? 'Sign in' : 'Create an account'}</Text>
              </Text>

              {SOCIAL_SIGN_IN.any ? (
                <>
                  <OrDivider label="or continue with" />
                  <SocialButtons pending={pending === 'email' ? null : pending} disabled={busy} onGoogle={() => void run('google', () => auth.googleSignIn())} onApple={() => void run('apple', () => auth.appleSignIn())} />
                </>
              ) : null}
            </View>
          </Reveal>

          <EntryBenefits business={true} />

          <View>
            <View style={entryStyles.secureRow}>
              <Ionicons name="shield-checkmark-outline" size={13} color={authColors.inkFaint} />
              <Text style={entryStyles.secureText}>Your session is encrypted on this device.</Text>
            </View>
            <Text style={entryStyles.legal}>
              By continuing you agree to Chakusa{"'"}s{' '}
              <Text accessibilityRole="link" style={entryStyles.legalLink} onPress={() => void Linking.openURL(TERMS_OF_USE_URL)}>Terms of Use</Text>
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
});
