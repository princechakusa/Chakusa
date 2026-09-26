import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { SOCIAL_SIGN_IN } from '../config';
import { authColors, authRadius, authShadow, authSpace, authType } from './authTheme';
import { PressableScale, Reveal, Shake, useReducedMotion } from './motion';

// PROGRAM 3: the pieces the business and customer auth screens share, so
// both surfaces look, move and fail identically.

export type SocialProvider = 'google' | 'apple';

/**
 * Google / Apple buttons, rendered only where the native SDK can complete
 * the flow (see socialSignInProviders). The pressed provider shows its own
 * spinner; every button is disabled while any sign-in is in flight.
 */
export function SocialButtons({ pending, disabled, onGoogle, onApple }: {
  pending: SocialProvider | null;
  disabled: boolean;
  onGoogle: () => void;
  onApple: () => void;
}) {
  if (!SOCIAL_SIGN_IN.any) return null;
  return (
    <View style={styles.social}>
      {SOCIAL_SIGN_IN.apple ? (
        <PressableScale testID="auth-apple" accessibilityRole="button" accessibilityLabel="Continue with Apple" accessibilityState={{ disabled, busy: pending === 'apple' }} disabled={disabled} onPress={onApple} style={[styles.socialBtn, styles.appleBtn, disabled && pending !== 'apple' && styles.dimmed]}>
          {pending === 'apple' ? <ActivityIndicator color={authColors.onCoral} /> : <Ionicons name="logo-apple" size={19} color={authColors.onCoral} />}
          <Text style={[styles.socialLabel, styles.appleLabel]}>{pending === 'apple' ? 'Connecting to Apple…' : 'Continue with Apple'}</Text>
        </PressableScale>
      ) : null}
      {SOCIAL_SIGN_IN.google ? (
        <PressableScale testID="auth-google" accessibilityRole="button" accessibilityLabel="Continue with Google" accessibilityState={{ disabled, busy: pending === 'google' }} disabled={disabled} onPress={onGoogle} style={[styles.socialBtn, disabled && pending !== 'google' && styles.dimmed]}>
          {pending === 'google' ? <ActivityIndicator color={authColors.coral} /> : <GoogleGlyph />}
          <Text style={styles.socialLabel}>{pending === 'google' ? 'Connecting to Google…' : 'Continue with Google'}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

function GoogleGlyph() {
  // Ionicons' Google logo is monochrome; tint it with Google blue so the
  // button reads as Google's at a glance without shipping a raster asset.
  return <Ionicons name="logo-google" size={18} color="#4285F4" />;
}

/** An inline, shaking alert. Rendered close to the controls that raised it. */
export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Reveal distance={6}>
      <Shake trigger={message}>
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" testID="auth-error" style={styles.error}>
          <Ionicons name="alert-circle" size={17} color={authColors.danger} />
          <Text style={styles.errorText}>{message}</Text>
        </View>
      </Shake>
    </Reveal>
  );
}

type Side = 'customer' | 'business';
const SIDES: Record<Side, { title: string; sub: string; switchLabel: string }> = {
  customer: { title: 'Book & track', sub: 'Personal', switchLabel: 'Switch to finding and booking services' },
  business: { title: 'Grow a business', sub: 'Manage & earn', switchLabel: 'Switch to running a business' },
};

/**
 * The Personal / Business switch. Tapping the other side slides the pill
 * across first, so the change of experience that follows is visibly the
 * result of the tap rather than a jump cut.
 */
export function ExperienceSegment({ active, switching, onSwitch }: { active: Side; switching: boolean; onSwitch: (side: Side) => void }) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const position = useRef(new Animated.Value(active === 'customer' ? 0 : 1)).current;
  const [target, setTarget] = useState<Side>(active);
  const other: Side = active === 'customer' ? 'business' : 'customer';
  const go = () => {
    if (switching || target !== active) return;
    setTarget(other);
    if (reduced) { onSwitch(other); return; }
    Animated.spring(position, { toValue: other === 'customer' ? 0 : 1, speed: 16, bounciness: 6, useNativeDriver: Platform.OS !== 'web', isInteraction: false }).start(() => onSwitch(other));
  };
  const pillWidth = Math.max(0, (width - authSpace.xxs * 3) / 2);
  const translateX = position.interpolate({ inputRange: [0, 1], outputRange: [0, pillWidth + authSpace.xxs] });
  return (
    <View style={styles.segment} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width ? <Animated.View pointerEvents="none" style={[styles.segmentPill, { width: pillWidth, transform: [{ translateX }] }]} /> : null}
      {(['customer', 'business'] as const).map((side) => {
        const isActive = side === target;
        return side === active ? (
          <View key={side} accessibilityState={{ selected: true }} style={styles.segmentItem}>
            <Text style={isActive ? styles.segmentTitleActive : styles.segmentTitle}>{SIDES[side].title}</Text>
            <Text style={styles.segmentSub}>{SIDES[side].sub}</Text>
          </View>
        ) : (
          <Pressable key={side} accessibilityRole="button" accessibilityLabel={SIDES[side].switchLabel} disabled={switching} onPress={go} style={styles.segmentItem}>
            <Text style={isActive ? styles.segmentTitleActive : styles.segmentTitle}>{SIDES[side].title}</Text>
            <Text style={styles.segmentSub}>{switching || isActive ? 'Switching…' : SIDES[side].sub}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A labelled input row whose border and icon light up coral while it has
 * focus, so it is always obvious where typing will land.
 */
export function AuthInput({ icon, accessory, onFocus, onBlur, ...props }: TextInputProps & { icon: keyof typeof Ionicons.glyphMap; accessory?: ReactNode }) {
  const [focused, setFocused] = useState(false);
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(glow, { toValue: focused ? 1 : 0, duration: 180, useNativeDriver: false, isInteraction: false }).start();
  }, [focused, glow]);
  const borderColor = glow.interpolate({ inputRange: [0, 1], outputRange: [authColors.line, authColors.coral] });
  const backgroundColor = glow.interpolate({ inputRange: [0, 1], outputRange: [authColors.surface, '#FFFBFA'] });
  return (
    <Animated.View style={[styles.field, { borderColor, backgroundColor }]}>
      <Ionicons name={icon} size={17} color={focused ? authColors.coral : authColors.inkFaint} style={styles.fieldIcon} />
      <TextInput
        placeholderTextColor={authColors.inkFaint}
        {...props}
        onFocus={(event) => { setFocused(true); onFocus?.(event); }}
        onBlur={(event) => { setFocused(false); onBlur?.(event); }}
        style={[styles.input, props.style]}
      />
      {accessory}
    </Animated.View>
  );
}

/** Shown when this platform has no usable sign-in method at all. */
export function NoSignInMethod() {
  return (
    <View style={styles.empty}>
      <Ionicons name="phone-portrait-outline" size={20} color={authColors.coral} />
      <Text style={styles.emptyText}>
        {Platform.OS === 'web'
          ? 'Sign in with Google or Apple from the Chakusa app on iPhone or Android.'
          : 'No sign-in method is configured for this build.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  social: { gap: authSpace.xs },
  socialBtn: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs, borderRadius: authRadius.md, backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.line, ...authShadow.card },
  appleBtn: { backgroundColor: '#000000', borderColor: '#000000' },
  socialLabel: { fontFamily: authType.label.fontFamily, fontSize: 15, color: authColors.ink },
  appleLabel: { color: authColors.onCoral },
  dimmed: { opacity: 0.5 },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: authSpace.xs, padding: authSpace.sm, borderRadius: authRadius.md, backgroundColor: '#FDECEC', borderWidth: 1, borderColor: '#F6CFCF' },
  errorText: { ...authType.body, fontSize: 13, lineHeight: 19, color: authColors.danger, flex: 1 },
  segment: { flexDirection: 'row', gap: authSpace.xxs, padding: authSpace.xxs, borderRadius: authRadius.lg, backgroundColor: authColors.bgSunk },
  segmentPill: { position: 'absolute', top: authSpace.xxs, bottom: authSpace.xxs, left: authSpace.xxs, borderRadius: authRadius.md, backgroundColor: authColors.surface, ...authShadow.card },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: authSpace.sm, borderRadius: authRadius.md, gap: 2 },
  segmentTitle: { fontFamily: authType.label.fontFamily, fontSize: 13, color: authColors.inkSoft },
  segmentTitleActive: { fontFamily: authType.label.fontFamily, fontSize: 13, color: authColors.coral },
  segmentSub: { ...authType.micro, letterSpacing: 0.2, fontSize: 10 },
  field: { minHeight: 52, flexDirection: 'row', alignItems: 'center', borderRadius: authRadius.md, borderWidth: 1, paddingHorizontal: authSpace.sm },
  fieldIcon: { marginRight: authSpace.xs },
  input: { flex: 1, paddingVertical: authSpace.sm, fontFamily: authType.body.fontFamily, fontSize: 15, color: authColors.ink, outlineStyle: 'none' } as never,
  empty: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, padding: authSpace.md, borderRadius: authRadius.md, backgroundColor: authColors.coralSoft },
  emptyText: { ...authType.body, fontSize: 13, color: authColors.ink, flex: 1 },
});
