import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, View, type PressableProps, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

// PROGRAM 3: the motion language for the entry surfaces (launch, welcome,
// both auth screens). Built on React Native's own Animated API with the
// native driver, so it adds no native dependency, runs off the JS thread on
// device, and renders identically on web. Every primitive honours the OS
// "reduce motion" setting by snapping straight to its final state.
//
// Rule for using these: motion must say something. Entrances set reading
// order, springs confirm touch, a nudge points the way, a shake flags an
// error. Nothing loops except soft ambient light and loading indicators.

const nativeDriver = Platform.OS !== 'web';
// Presentational motion must never hold an InteractionManager handle: an
// ambient loop would otherwise block runAfterInteractions forever (it does
// on web, where the native driver is unavailable), stalling real work such
// as the experience switch.
const driver = { useNativeDriver: nativeDriver, isInteraction: false } as const;
export const motionEase = Easing.bezier(0.22, 1, 0.36, 1);

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) setReduced(value); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}

/**
 * Fades and lifts its children into place, `delay` ms after mount. With
 * `spring`, it overshoots slightly and settles - for things that should
 * feel physical (cards arriving), never for body text.
 */
export function Reveal({ children, delay = 0, distance = 18, fromScale = 1, spring = false, style, testID }: { children: ReactNode; delay?: number; distance?: number; fromScale?: number; spring?: boolean; style?: StyleProp<ViewStyle>; testID?: string }) {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { progress.setValue(1); opacity.setValue(1); return; }
    const animation = Animated.parallel([
      spring
        ? Animated.spring(progress, { toValue: 1, delay, speed: 9, bounciness: 9, ...driver })
        : Animated.timing(progress, { toValue: 1, duration: 680, delay, easing: motionEase, ...driver }),
      Animated.timing(opacity, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.quad), ...driver }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [delay, opacity, progress, reduced, spring]);
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] });
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [fromScale, 1] });
  return <Animated.View testID={testID} style={[style, { opacity, transform: [{ translateY }, { scale }] }]}>{children}</Animated.View>;
}

/**
 * Reveals text one piece at a time - letters for a short wordmark, words for
 * a headline - so the eye reads it as it arrives. Assistive technology gets
 * the whole string once, from the container's label.
 */
export function StaggerText({ text, by = 'word', delay = 0, step = 70, distance = 14, style, role, testID }: { text: string; by?: 'word' | 'letter'; delay?: number; step?: number; distance?: number; style: StyleProp<TextStyle>; role?: 'header'; testID?: string }) {
  const reduced = useReducedMotion();
  const pieces = by === 'letter' ? [...text] : text.split(' ');
  const values = useRef(pieces.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduced) { values.forEach((value) => value.setValue(1)); return; }
    const animation = Animated.stagger(step, values.map((value) => Animated.timing(value, { toValue: 1, duration: 520, easing: motionEase, ...driver })));
    const timer = setTimeout(() => animation.start(), delay);
    return () => { clearTimeout(timer); animation.stop(); };
  }, [delay, reduced, step, values]);
  return (
    <View testID={testID} accessible accessibilityRole={role} accessibilityLabel={text} style={styles.staggerRow}>
      {pieces.map((piece, index) => (
        <Animated.Text
          key={`${piece}-${index}`}
          importantForAccessibility="no"
          style={[style, {
            opacity: values[index],
            transform: [{ translateY: values[index].interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
          }]}
        >
          {piece}{by === 'word' && index < pieces.length - 1 ? ' ' : ''}
        </Animated.Text>
      ))}
    </View>
  );
}

/** Pops a small element in with a springy scale - chips, badges, icons. */
export function Pop({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const reduced = useReducedMotion();
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) { value.setValue(1); return; }
    const animation = Animated.spring(value, { toValue: 1, delay, speed: 14, bounciness: 14, ...driver });
    animation.start();
    return () => animation.stop();
  }, [delay, reduced, value]);
  return <Animated.View style={{ opacity: value.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }), transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }}>{children}</Animated.View>;
}

/** A one-time sideways nudge after `delay` ms - an arrow saying "this way". */
export function Nudge({ children, delay = 0, distance = 7 }: { children: ReactNode; delay?: number; distance?: number }) {
  const reduced = useReducedMotion();
  const offset = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const push = (toValue: number, duration: number) => Animated.timing(offset, { toValue, duration, easing: Easing.inOut(Easing.quad), ...driver });
    const animation = Animated.sequence([push(distance, 200), push(0, 220), push(distance * 0.6, 170), push(0, 260)]);
    const timer = setTimeout(() => animation.start(), delay);
    return () => { clearTimeout(timer); animation.stop(); };
  }, [delay, distance, offset, reduced]);
  return <Animated.View style={{ transform: [{ translateX: offset }] }}>{children}</Animated.View>;
}

/** A Pressable that springs down while held and back on release. */
export function PressableScale({ children, style, scaleTo = 0.97, disabled, ...props }: Omit<PressableProps, 'style' | 'children'> & { children: ReactNode; style?: StyleProp<ViewStyle>; scaleTo?: number }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (value: number) => Animated.spring(scale, { toValue: value, speed: 40, bounciness: value === 1 ? 8 : 0, ...driver }).start();
  return (
    <Pressable
      {...props}
      disabled={disabled}
      onPressIn={(event) => { to(scaleTo); props.onPressIn?.(event); }}
      onPressOut={(event) => { to(1); props.onPressOut?.(event); }}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/**
 * A soft coloured orb that slowly breathes and drifts behind content. With
 * `bloom`, it first grows out of nothing - the warm light a screen opens on.
 */
export function AmbientOrb({ size, color, style, duration = 7000, drift = 18, bloom = false }: { size: number; color: string; style?: StyleProp<ViewStyle>; duration?: number; drift?: number; bloom?: boolean }) {
  const reduced = useReducedMotion();
  const cycle = useRef(new Animated.Value(0)).current;
  const grow = useRef(new Animated.Value(bloom ? 0 : 1)).current;
  useEffect(() => {
    if (reduced) { grow.setValue(1); return; }
    const opening = bloom ? Animated.timing(grow, { toValue: 1, duration: 1100, easing: motionEase, ...driver }) : null;
    opening?.start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(cycle, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), ...driver }),
      Animated.timing(cycle, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), ...driver }),
    ]));
    loop.start();
    return () => { opening?.stop(); loop.stop(); };
  }, [bloom, cycle, duration, grow, reduced]);
  const breathe = cycle.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const scale = Animated.multiply(breathe, grow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }));
  const translateY = cycle.interpolate({ inputRange: [0, 1], outputRange: [0, drift] });
  const translateX = cycle.interpolate({ inputRange: [0, 1], outputRange: [0, -drift * 0.6] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style, { opacity: grow, transform: [{ translateX }, { translateY }, { scale }] }]}
    />
  );
}

/** Expanding, fading rings that radiate from behind a centred element. */
export function PulseRings({ size, color, rings = 2, period = 2800 }: { size: number; color: string; rings?: number; period?: number }) {
  const reduced = useReducedMotion();
  const values = useRef(Array.from({ length: rings }, () => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduced) return;
    const loops = values.map((value, index) => Animated.loop(Animated.sequence([
      // Not Animated.delay: it always registers an interaction handle.
      Animated.timing(value, { toValue: 0, duration: 0, delay: (period / rings) * index, ...driver }),
      Animated.timing(value, { toValue: 1, duration: period, easing: Easing.out(Easing.quad), ...driver }),
      Animated.timing(value, { toValue: 0, duration: 0, ...driver }),
    ])));
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [period, reduced, rings, values]);
  if (reduced) return null;
  return (
    <>
      {values.map((value, index) => (
        <Animated.View
          key={index}
          pointerEvents="none"
          style={{
            position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: color,
            opacity: value.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.55, 0] }),
            transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.9] }) }],
          }}
        />
      ))}
    </>
  );
}

/**
 * Brings the logo in. By default it springs in place with a small turn;
 * with `landFrom`, it first appears large in the middle of the screen and
 * then lands in its header slot - the brand first, then the choices. With
 * `idle` it keeps floating gently afterwards (loading screens only, as a
 * sign that the app is working).
 */
export function HeroMark({ children, idle = false, landFrom }: { children: ReactNode; idle?: boolean; landFrom?: { y: number; scale: number } }) {
  const reduced = useReducedMotion();
  const intro = useRef(new Animated.Value(0)).current;
  const appear = useRef(new Animated.Value(landFrom ? 0 : 1)).current;
  const float = useRef(new Animated.Value(0)).current;
  const landing = Boolean(landFrom);
  useEffect(() => {
    if (reduced) { intro.setValue(1); appear.setValue(1); return; }
    const floatLoop = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), ...driver }),
      Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), ...driver }),
    ]));
    const entrance = landing
      ? Animated.parallel([
        Animated.timing(appear, { toValue: 1, duration: 360, easing: Easing.out(Easing.quad), ...driver }),
        Animated.spring(intro, { toValue: 1, delay: 480, speed: 5, bounciness: 6, ...driver }),
      ])
      : Animated.spring(intro, { toValue: 1, speed: 6, bounciness: 12, ...driver });
    entrance.start(({ finished }) => { if (finished && idle) floatLoop.start(); });
    return () => { entrance.stop(); floatLoop.stop(); };
  }, [appear, float, idle, intro, landing, reduced]);
  const scale = intro.interpolate({ inputRange: [0, 1], outputRange: [landFrom?.scale ?? 0.4, 1] });
  const rotate = intro.interpolate({ inputRange: [0, 1], outputRange: [landing ? '0deg' : '-14deg', '0deg'] });
  const translateY = Animated.add(
    intro.interpolate({ inputRange: [0, 1], outputRange: [landFrom?.y ?? 0, 0] }),
    float.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }),
  );
  const opacity = landing ? appear : intro.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] });
  return (
    <Animated.View style={{ opacity, transform: [{ translateY }, { scale }, { rotate }] }}>
      {children}
    </Animated.View>
  );
}

/** Cycles through short phrases with a soft vertical cross-fade. */
export function RotatingText({ phrases, interval = 2600, render }: { phrases: readonly string[]; interval?: number; render: (phrase: string) => ReactNode }) {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced || phrases.length < 2) return;
    const timer = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 220, easing: Easing.in(Easing.quad), ...driver }).start(({ finished }) => {
        if (!finished) return;
        setIndex((current) => (current + 1) % phrases.length);
        Animated.timing(fade, { toValue: 1, duration: 360, easing: motionEase, ...driver }).start();
      });
    }, interval);
    return () => clearInterval(timer);
  }, [fade, interval, phrases.length, reduced]);
  const translateY = fade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return <Animated.View style={{ opacity: fade, transform: [{ translateY }] }}>{render(phrases[index] ?? '')}</Animated.View>;
}

/** Shakes horizontally whenever `trigger` changes to a new truthy value. */
export function Shake({ trigger, children }: { trigger: unknown; children: ReactNode }) {
  const reduced = useReducedMotion();
  const offset = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!trigger || reduced) return;
    const step = (toValue: number) => Animated.timing(offset, { toValue, duration: 55, easing: Easing.linear, ...driver });
    Animated.sequence([step(9), step(-9), step(6), step(-6), step(2), step(0)]).start();
  }, [offset, reduced, trigger]);
  return <Animated.View style={{ transform: [{ translateX: offset }] }}>{children}</Animated.View>;
}

/**
 * Plays a short exit - the chosen element lifts, everything else clears -
 * and then calls `then`. Returns the animated values the screen binds to.
 */
export function useExit() {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const busy = useRef(false);
  const run = (then: () => void) => {
    if (busy.current) return;
    busy.current = true;
    if (reduced) { then(); busy.current = false; return; }
    Animated.timing(progress, { toValue: 1, duration: 340, easing: Easing.in(Easing.cubic), ...driver }).start(() => {
      then();
      // Normally the screen unmounts; if it is still here after the next
      // screen had ample time to mount (a refused switch), bring it back.
      setTimeout(() => { progress.setValue(0); busy.current = false; }, 1500);
    });
  };
  return { progress, run };
}

const styles = StyleSheet.create({
  staggerRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
});
