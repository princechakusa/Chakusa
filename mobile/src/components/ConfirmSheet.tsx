import { Ionicons } from '@expo/vector-icons';
import { useCallback, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authColors, authFont, authRadius, authSpace, authType } from '../experience/authTheme';

type IconName = keyof typeof Ionicons.glyphMap;

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** Red confirm button for irreversible or session-ending actions. */
  destructive?: boolean;
  icon?: IconName;
}

/**
 * A bottom-sheet Yes/No confirmation shared by both apps (sign out, delete
 * account, …). `confirm()` resolves true only when the person taps the
 * confirm button; tapping outside, Cancel or Android back resolves false.
 *
 *   const { confirm, sheet } = useConfirmSheet();
 *   if (await confirm({ title: 'Sign out?', confirmLabel: 'Sign out', destructive: true })) …
 *   return <>{…}{sheet}</>;
 */
export function useConfirmSheet() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);

  const settle = useCallback((value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  }, []);

  const confirm = useCallback((next: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolver.current?.(false);
    resolver.current = resolve;
    setOptions(next);
  }), []);

  const sheet = <ConfirmSheet options={options} onSettle={settle} />;
  return { confirm, sheet };
}

function ConfirmSheet({ options, onSettle }: { options: ConfirmOptions | null; onSettle: (value: boolean) => void }) {
  const insets = useSafeAreaInsets();
  const tone = options?.destructive ? authColors.danger : authColors.coral;
  return (
    <Modal visible={Boolean(options)} transparent animationType="fade" statusBarTranslucent onRequestClose={() => onSettle(false)}>
      <Pressable accessibilityLabel="Dismiss" style={styles.backdrop} onPress={() => onSettle(false)} />
      {options ? (
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, authSpace.md) + authSpace.xs }]} accessibilityViewIsModal>
          <View style={styles.grabber} />
          <View style={[styles.iconWrap, { backgroundColor: options.destructive ? '#FDECEC' : authColors.coralSoft }]}>
            <Ionicons name={options.icon ?? (options.destructive ? 'alert-circle-outline' : 'help-circle-outline')} size={26} color={tone} />
          </View>
          <Text accessibilityRole="header" style={styles.title}>{options.title}</Text>
          {options.message ? <Text style={styles.message}>{options.message}</Text> : null}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" onPress={() => onSettle(true)} style={({ pressed }) => [styles.button, { backgroundColor: tone }, pressed && styles.pressed]}>
              <Text style={styles.confirmText}>{options.confirmLabel}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => onSettle(false)} style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}>
              <Text style={styles.cancelText}>{options.cancelLabel ?? 'Cancel'}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(14,17,22,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: authColors.surface, borderTopLeftRadius: authRadius.xl, borderTopRightRadius: authRadius.xl, paddingHorizontal: authSpace.lg, paddingTop: authSpace.xs, alignItems: 'center' },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: authColors.line, marginBottom: authSpace.md },
  iconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: authSpace.sm },
  title: { ...authType.cardTitle, textAlign: 'center' },
  message: { ...authType.body, textAlign: 'center', marginTop: authSpace.xxs, maxWidth: 360 },
  actions: { alignSelf: 'stretch', gap: authSpace.xs, marginTop: authSpace.lg },
  button: { minHeight: 52, borderRadius: authRadius.pill, alignItems: 'center', justifyContent: 'center' },
  cancel: { backgroundColor: authColors.bgSunk },
  pressed: { opacity: 0.75 },
  confirmText: { fontFamily: authFont.bodySemibold, fontSize: 15, color: '#FFFFFF' },
  cancelText: { fontFamily: authFont.bodySemibold, fontSize: 15, color: authColors.ink },
});
