import { Ionicons } from '../icons';
import { forwardRef, ReactElement, ReactNode, useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { interpolate, useAnimatedStyle } from 'react-native-reanimated';

// WhatsApp-style chat building blocks shared by customer Messages, the
// business inbox thread and the Chakusa assistant:
//  - ChatLayout: fixed header, only the message list scrolls, and the
//    composer sits exactly on top of the keyboard (edge-to-edge safe).
//  - ChatThread: inverted list (newest at the bottom, opens there and stays
//    pinned when the keyboard opens or a message arrives), day chips,
//    tail bubbles, time inside the bubble, typing dots.
//  - ChatComposer: pill input that grows to 6 lines, round send button.

export interface ChatPalette {
  bg: string;
  mineBubble: string; mineText: string; mineMeta: string;
  theirBubble: string; theirText: string; theirMeta: string; theirBorder: string;
  composerBg: string; inputBg: string; inputBorder: string; inputText: string; placeholder: string;
  sendBg: string; sendIcon: string;
  chipBg: string; chipText: string;
  line: string;
  font: { body: string; medium: string; semibold: string };
}

export { chatRows, chatTime, type ChatMessage, type ChatRow } from './chatRows';
import { chatRows, chatTime, type ChatMessage, type ChatRow as Row } from './chatRows';

/**
 * Screen body below a fixed header. The messages and composer ride up with
 * the keyboard frame by frame (react-native-keyboard-controller), like
 * WhatsApp; the header never moves.
 */
export function ChatLayout({ palette, header, children }: { palette: ChatPalette; header: ReactNode; children: ReactNode }) {
  return (
    <View style={[styles.fill, { backgroundColor: palette.bg }]}>
      {header}
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>{children}</KeyboardAvoidingView>
    </View>
  );
}

export const ChatThread = forwardRef<FlatList<Row>, {
  messages: ChatMessage[];
  palette: ChatPalette;
  typing?: boolean;
  empty?: ReactElement | null;
  footerNote?: ReactNode;
}>(function ChatThread({ messages, palette, typing = false, empty, footerNote }, ref) {
  const rows = useMemo(() => chatRows(messages), [messages]);
  if (!messages.length && !typing && empty) return <View style={styles.fill}>{empty}</View>;
  return (
    <FlatList
      ref={ref}
      inverted
      data={rows}
      keyExtractor={(row) => row.id}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      contentContainerStyle={styles.threadContent}
      ListHeaderComponent={<>{footerNote}{typing ? <TypingBubble palette={palette} /> : null}</>}
      renderItem={({ item }) => item.kind === 'day'
        ? <View style={styles.dayRow}><Text style={[styles.dayChip, { backgroundColor: palette.chipBg, color: palette.chipText, fontFamily: palette.font.medium }]}>{item.label}</Text></View>
        : <Bubble message={item.message} first={item.first} palette={palette} />}
    />
  );
});

function Bubble({ message, first, palette }: { message: ChatMessage; first: boolean; palette: ChatPalette }) {
  const mine = message.mine;
  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs, first && styles.groupGap]}>
      <View style={[
        styles.bubble,
        mine ? { backgroundColor: palette.mineBubble } : { backgroundColor: palette.theirBubble, borderColor: palette.theirBorder, borderWidth: StyleSheet.hairlineWidth },
        first && (mine ? styles.tailMine : styles.tailTheirs),
      ]}>
        <Text style={[styles.bubbleText, { color: mine ? palette.mineText : palette.theirText, fontFamily: palette.font.body }]}>{message.text}</Text>
        <View style={styles.meta}>
          {message.failed ? <Ionicons name="alert-circle" size={12} color="#E5484D" /> : null}
          <Text style={[styles.time, { color: mine ? palette.mineMeta : palette.theirMeta, fontFamily: palette.font.body }]}>{chatTime(message.at)}</Text>
        </View>
      </View>
      {message.footer}
    </View>
  );
}

function TypingBubble({ palette }: { palette: ChatPalette }) {
  const dots = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const loops = dots.map((value, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 160),
      Animated.timing(value, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(value, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.delay((2 - i) * 160),
    ])));
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dots]);
  return (
    <View accessibilityLabel="Typing" style={[styles.bubbleRow, styles.rowTheirs, styles.groupGap]}>
      <View style={[styles.bubble, styles.typing, styles.tailTheirs, { backgroundColor: palette.theirBubble, borderColor: palette.theirBorder, borderWidth: StyleSheet.hairlineWidth }]}>
        {dots.map((value, i) => (
          <Animated.View key={i} style={[styles.dot, { backgroundColor: palette.theirMeta, opacity: value.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }), transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) }] }]} />
        ))}
      </View>
    </View>
  );
}

export function ChatComposer({ value, onChangeText, onSend, sending = false, disabled = false, placeholder = 'Message', palette, note, maxLength = 2000 }: {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  placeholder?: string;
  palette: ChatPalette;
  note?: ReactNode;
  maxLength?: number;
}) {
  const insets = useSafeAreaInsets();
  const { progress } = useReanimatedKeyboardAnimation();
  const restingPad = Math.max(insets.bottom, 8);
  // The home-indicator gap is only needed while the keyboard is down.
  const padding = useAnimatedStyle(() => ({ paddingBottom: interpolate(progress.value, [0, 1], [restingPad, 8]) }));
  const canSend = Boolean(value.trim()) && !sending && !disabled;
  return (
    <Reanimated.View style={[styles.composer, { backgroundColor: palette.composerBg, borderTopColor: palette.line }, padding]}>
      {note}
      <View style={styles.composerRow}>
        <View style={[styles.inputWrap, { backgroundColor: palette.inputBg, borderColor: palette.inputBorder }]}>
          <TextInput
            accessibilityLabel={placeholder}
            value={value}
            onChangeText={onChangeText}
            editable={!disabled}
            placeholder={placeholder}
            placeholderTextColor={palette.placeholder}
            multiline
            maxLength={maxLength}
            textAlignVertical="center"
            style={[styles.input, { color: palette.inputText, fontFamily: palette.font.body }]}
          />
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!canSend} onPress={onSend} style={({ pressed }) => [styles.send, { backgroundColor: palette.sendBg }, !canSend && styles.sendIdle, pressed && styles.pressed]}>
          {sending ? <ActivityIndicator size="small" color={palette.sendIcon} /> : <Ionicons name="send" size={19} color={palette.sendIcon} style={styles.sendIcon} />}
        </Pressable>
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  threadContent: { paddingHorizontal: 10, paddingVertical: 10 },
  dayRow: { alignItems: 'center', marginVertical: 10 },
  dayChip: { fontSize: 12, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10, overflow: 'hidden' },
  bubbleRow: { marginTop: 2, maxWidth: '82%' },
  groupGap: { marginTop: 8 },
  rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  // Text and time share a wrapping row: a short message keeps the time beside it,
  // a full line pushes the time onto its own line at the right. Never overlaps.
  bubble: { borderRadius: 16, paddingLeft: 11, paddingRight: 9, paddingTop: 7, paddingBottom: 6, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'flex-end', columnGap: 8 },
  tailMine: { borderTopRightRadius: 4 },
  tailTheirs: { borderTopLeftRadius: 4 },
  bubbleText: { fontSize: 15.5, lineHeight: 21, flexShrink: 1 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 'auto', paddingTop: 2 },
  time: { fontSize: 11 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 13, paddingHorizontal: 14 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  composer: { paddingHorizontal: 12, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, gap: 6 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  inputWrap: { flex: 1, minHeight: 46, maxHeight: 140, borderRadius: 23, borderWidth: 1, paddingHorizontal: 16, justifyContent: 'center' },
  input: { fontSize: 16, lineHeight: 21, paddingTop: 11, paddingBottom: 11, maxHeight: 138 },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { marginLeft: 2 },
  sendIdle: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
});
