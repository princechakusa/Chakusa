import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChatComposer, ChatLayout, ChatThread, type ChatMessage, type ChatPalette } from '../components/chat/ChatKit';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ConversationDetailDto, messagingApi } from '../services/endpoints';
import { useAppState } from '../state/AppContext';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Icon, M3Error, M3Loading } from '../experience/businessKit';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const businessChatPalette: ChatPalette = {
  bg: '#F1F2F8',
  mineBubble: m3.primary, mineText: m3.onPrimary, mineMeta: 'rgba(255,255,255,0.75)',
  theirBubble: m3.surfaceContainerLowest, theirText: m3.onSurface, theirMeta: '#7A7F91', theirBorder: m3.surfaceContainerHigh,
  composerBg: m3.surfaceContainerLowest, inputBg: m3.surfaceContainerLow, inputBorder: m3.surfaceContainerHigh, inputText: m3.onSurface, placeholder: '#7A7F91',
  sendBg: m3.primary, sendIcon: m3.onPrimary,
  chipBg: 'rgba(255,255,255,0.9)', chipText: '#59607A',
  line: m3.surfaceContainerHigh,
  font: { body: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold' },
};
// Letters only: a phone-number "name" (+9715…) has no initials, so it gets a person icon.
function initials(name: string) {
  return name.split(/\s+/).map((part) => part.match(/\p{L}/u)?.[0]?.toUpperCase() ?? '').filter(Boolean).slice(0, 2).join('');
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
  const insets = useSafeAreaInsets();

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
  // A Chakusa app customer's question: replies go back in the app (push), not SMS.
  const inApp = data?.contextType === 'CUSTOMER_APP_INQUIRY';
  const canReply = inApp || Boolean(customerId);
  const clientName = customer?.name ?? (inApp ? data?.subject : null) ?? 'Conversation';
  const lastChannel = (data?.messages[data.messages.length - 1]?.channel ?? 'sms').toLowerCase();
  const channel: 'sms' | 'whatsapp' = lastChannel === 'whatsapp' ? 'whatsapp' : 'sms';

  const send = async () => {
    const body = draft.trim();
    if (!body || sending || !canReply) return;
    setSending(true);
    setSendError(null);
    try {
      if (inApp) await messagingApi.replyInApp(conversationId, body);
      else await messagingApi.send({ customerId: customerId!, body, channel });
      setDraft('');
      await load();
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : 'Message could not be sent.');
    } finally {
      setSending(false);
    }
  };

  const chat: ChatMessage[] = (data?.messages ?? []).map((m) => ({
    id: m.id,
    text: m.contents?.[0]?.body ?? m.body,
    mine: !(m.direction ?? '').toLowerCase().startsWith('in'),
    at: m.sentAt ?? m.createdAt,
  }));
  const note = data?.notes.length ? (
    <View style={styles.noteCard}>
      <View style={styles.noteHead}>
        <Icon name="lock" size={13} color={m3.outline} />
        <Text style={styles.noteHeadText}>INTERNAL NOTE · NOT VISIBLE TO CLIENT</Text>
      </View>
      <Text style={styles.noteBody}>{data.notes[data.notes.length - 1].body}</Text>
    </View>
  ) : null;

  const header = (
    <View style={[styles.headerWrap, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow_back_ios" size={16} color={m3.primary} />
          <Text style={styles.backText}>Messages</Text>
        </Pressable>
      </View>
      <View style={styles.clientBar}>
        <View style={styles.clientAvatar}>
          {initials(clientName) ? <Text style={styles.clientInitials}>{initials(clientName)}</Text> : <Icon name="person" size={22} color={m3.primary} />}
        </View>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={styles.clientName}>{clientName}</Text>
          <Text numberOfLines={1} style={styles.clientMeta}>
            {inApp ? 'Chakusa app customer' : (customer?.phone && customer.phone !== clientName ? customer.phone : null) ?? customer?.email ?? 'Client conversation'}
          </Text>
        </View>
        {customerId ? (
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('CustomerProfile', { customerId })} style={styles.viewProfileBtn}>
            <Text style={styles.viewProfileText}>Profile</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <ChatLayout palette={businessChatPalette} header={header}>
      {loading && !data ? (
        <M3Loading label="Loading conversation…" />
      ) : error ? (
        <M3Error message={error} onRetry={() => void load()} />
      ) : (
        <ChatThread
          messages={chat}
          palette={businessChatPalette}
          footerNote={note}
          empty={<View style={styles.emptyWrap}>{note}<Text style={styles.empty}>No messages in this conversation yet.</Text></View>}
        />
      )}
      <ChatComposer
        value={draft}
        onChangeText={setDraft}
        onSend={() => void send()}
        sending={sending}
        disabled={!canReply}
        placeholder={inApp ? 'Reply in the Chakusa app' : 'Message'}
        palette={businessChatPalette}
        note={sendError || !canReply ? (
          <Text style={sendError ? styles.sendError : styles.composerNote}>
            {sendError ?? "This conversation has no linked client, so a reply can't be sent from here yet."}
          </Text>
        ) : null}
      />
    </ChatLayout>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  headerWrap: { backgroundColor: m3.surfaceContainerLowest, borderBottomWidth: 1, borderBottomColor: m3.surfaceContainerHigh },
  headerBar: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: m3Space.sm },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { ...m3Type.labelMd, color: m3.primary },
  clientBar: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, paddingHorizontal: m3Space.md, paddingBottom: m3Space.sm },
  clientAvatar: { width: 44, height: 44, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  clientInitials: { ...m3Type.labelLg, color: m3.primary },
  clientName: { ...m3Type.headlineSm, fontSize: 17, color: m3.onSurface },
  clientMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  viewProfileBtn: { paddingHorizontal: 12, height: 32, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  viewProfileText: { ...m3Type.labelSm, color: m3.primary, letterSpacing: 0 },
  emptyWrap: { flex: 1, justifyContent: 'center', padding: m3Space.md, gap: m3Space.md },
  empty: { ...m3Type.bodySm, color: m3.onSurfaceVariant, textAlign: 'center' },
  noteCard: { backgroundColor: m3.surfaceContainerHigh, borderRadius: m3Radius.md, padding: m3Space.sm, gap: 4, marginVertical: 8 },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  noteHeadText: { ...m3Type.labelXs, color: m3.onSurfaceVariant, letterSpacing: 0.4 },
  noteBody: { ...m3Type.bodySm, color: m3.onSurface, paddingLeft: 18 },
  composerNote: { ...m3Type.bodySm, color: m3.onSurfaceVariant, paddingHorizontal: 4 },
  sendError: { ...m3Type.bodySm, color: m3.error, paddingHorizontal: 4 },
});
