import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ConversationDetailDto, messagingApi } from '../services/endpoints';
import { useAppState } from '../state/AppContext';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Icon, M3Error, M3Loading } from '../experience/businessKit';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function clock(iso: string) {
  const d = new Date(iso);
  const h = d.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function MessageThreadScreen() {
  const navigation = useNavigation<Nav>();
  const { conversationId } = useRoute<RouteProp<RootStackParamList, 'MessageThread'>>().params;
  const { customers } = useAppState();
  const [data, setData] = useState<ConversationDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await messagingApi.conversation(conversationId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load this conversation.');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const customerId = useMemo(() => {
    if (!data) return null;
    return (
      data.participants.find((p) => p.customerId)?.customerId ??
      data.messages.find((m) => m.customerId)?.customerId ??
      null
    );
  }, [data]);
  const customer = customerId ? customers.find((c) => c.id === customerId) : null;
  const clientName = customer?.name ?? 'Conversation';
  const lastChannel = (data?.messages[data.messages.length - 1]?.channel ?? 'sms').toLowerCase();
  const channel: 'sms' | 'whatsapp' = lastChannel === 'whatsapp' ? 'whatsapp' : 'sms';

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !customerId) return;
    setSending(true);
    setSendError(null);
    try {
      await messagingApi.send({ customerId, body, channel });
      setDraft('');
      await load();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.headerBar}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow_back_ios" size={16} color={m3.primary} />
          <Text style={styles.backText}>Messages</Text>
        </Pressable>
        <View style={styles.headerActions}>
          {customer?.phone ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Call" style={styles.headerIconBtn}>
              <Icon name="call" size={18} color={m3.onSurface} />
            </Pressable>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel="More" style={styles.headerIconBtn}>
            <Icon name="more_vert" size={18} color={m3.onSurface} />
          </Pressable>
        </View>
      </View>

      <View style={styles.clientBar}>
        <View style={styles.clientAvatar}>
          <Text style={styles.clientInitials}>{initials(clientName)}</Text>
        </View>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={styles.clientName}>
            {clientName}
          </Text>
          <Text numberOfLines={1} style={styles.clientMeta}>
            {customer?.phone ?? customer?.email ?? `${channel.toUpperCase()} conversation`}
          </Text>
        </View>
        {customerId ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('CustomerProfile', { customerId })}
            style={styles.viewProfileBtn}
          >
            <Text style={styles.viewProfileText}>Profile</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <M3Loading label="Loading conversation…" />
      ) : error ? (
        <M3Error message={error} onRetry={() => void load()} />
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={8}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.flex}
            contentContainerStyle={styles.thread}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
          >
            {data?.messages.length ? (
              data.messages.map((m) => {
                const inbound = (m.direction ?? '').toLowerCase().startsWith('in');
                const text = m.contents?.[0]?.body ?? m.body;
                return (
                  <View key={m.id} style={[styles.bubbleRow, inbound ? styles.bubbleRowIn : styles.bubbleRowOut]}>
                    <View style={[styles.bubble, inbound ? styles.bubbleIn : styles.bubbleOut]}>
                      <Text style={[styles.bubbleText, inbound ? styles.bubbleTextIn : styles.bubbleTextOut]}>{text}</Text>
                    </View>
                    <Text style={styles.bubbleTime}>
                      {inbound ? clientName.split(' ')[0] : 'You'} · {clock(m.sentAt ?? m.createdAt)}
                    </Text>
                  </View>
                );
              })
            ) : (
              <Text style={styles.empty}>No messages in this conversation yet.</Text>
            )}
            {data?.notes.length ? (
              <View style={styles.noteCard}>
                <View style={styles.noteHead}>
                  <Icon name="lock" size={13} color={m3.outline} />
                  <Text style={styles.noteHeadText}>INTERNAL NOTE · NOT VISIBLE TO CLIENT</Text>
                </View>
                <Text style={styles.noteBody}>{data.notes[data.notes.length - 1].body}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.composer}>
            {sendError ? <Text style={styles.sendError}>{sendError}</Text> : null}
            {!customerId ? (
              <Text style={styles.composerNote}>
                This conversation has no linked client, so a reply can't be sent from here yet.
              </Text>
            ) : null}
            <View style={styles.composerRow}>
              <View style={styles.composerInputWrap}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  editable={Boolean(customerId) && !sending}
                  placeholder={`Message over ${channel.toUpperCase()}…`}
                  placeholderTextColor={m3.onSurfaceVariant}
                  multiline
                  style={styles.composerInput}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                disabled={!draft.trim() || sending || !customerId}
                onPress={() => void send()}
                style={[styles.sendBtn, (!draft.trim() || sending || !customerId) && styles.sendBtnDisabled]}
              >
                <Icon name={sending ? 'hourglass_empty' : 'send'} size={18} color={m3.onPrimary} />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  screen: { flex: 1, backgroundColor: m3.surface },

  headerBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: m3Space.sm,
    backgroundColor: m3.surfaceContainerLowest,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { ...m3Type.labelMd, color: m3.primary },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerIconBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },

  clientBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: m3Space.sm,
    paddingHorizontal: m3Space.md,
    paddingBottom: m3Space.sm,
    backgroundColor: m3.surfaceContainerLowest,
    borderBottomWidth: 1,
    borderBottomColor: m3.surfaceContainerHigh,
  },
  clientAvatar: { width: 44, height: 44, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  clientInitials: { ...m3Type.labelLg, color: m3.primary },
  clientName: { ...m3Type.headlineSm, fontSize: 17, color: m3.onSurface },
  clientMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  viewProfileBtn: { paddingHorizontal: 12, height: 32, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  viewProfileText: { ...m3Type.labelSm, color: m3.primary, letterSpacing: 0 },

  thread: { padding: m3Space.md, gap: m3Space.md },
  bubbleRow: { maxWidth: '85%', gap: 3 },
  bubbleRowIn: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubbleRowOut: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: m3Radius.lg },
  bubbleIn: { backgroundColor: m3.surfaceContainerLowest, borderTopLeftRadius: 4 },
  bubbleOut: { backgroundColor: m3.primary, borderTopRightRadius: 4 },
  bubbleText: { ...m3Type.bodyMd },
  bubbleTextIn: { color: m3.onSurface },
  bubbleTextOut: { color: m3.onPrimary },
  bubbleTime: { ...m3Type.labelXs, color: m3.onSurfaceVariant, paddingHorizontal: 4 },
  empty: { ...m3Type.bodySm, color: m3.onSurfaceVariant, textAlign: 'center', paddingVertical: m3Space.xl },

  noteCard: { backgroundColor: m3.surfaceContainerHigh, borderRadius: m3Radius.md, padding: m3Space.sm, gap: 4 },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  noteHeadText: { ...m3Type.labelXs, color: m3.onSurfaceVariant, letterSpacing: 0.4 },
  noteBody: { ...m3Type.bodySm, color: m3.onSurface, paddingLeft: 18 },

  composer: { padding: m3Space.sm, backgroundColor: m3.surfaceContainerLowest, borderTopWidth: 1, borderTopColor: m3.surfaceContainerHigh, gap: 6 },
  composerNote: { ...m3Type.bodySm, color: m3.onSurfaceVariant, paddingHorizontal: 4 },
  sendError: { ...m3Type.bodySm, color: m3.error, paddingHorizontal: 4 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: m3Space.xs },
  composerInputWrap: { flex: 1, backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.md, paddingHorizontal: 12, paddingVertical: 8, minHeight: 40, maxHeight: 120, justifyContent: 'center' },
  composerInput: { ...m3Type.bodyMd, color: m3.onSurface, padding: 0 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
