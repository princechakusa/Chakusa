import { Ionicons } from '../../components/icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CustomerAIConversationDto, CustomerAIMessageDto } from '../../apiTypes';
import { ChatComposer, ChatLayout, ChatThread, type ChatMessage } from '../../components/chat/ChatKit';
import { aiDataSharingDisclosure } from '../../domain/aiDataSharing';
import { hasAiConsent, recordAiConsent } from '../../services/aiConsent';
import { ApiError } from '../../services/api';
import { formatDateTime } from '../../utils/format';
import { customerChatPalette } from '../chatPalette';
import { useCustomerAuth } from '../CustomerAuthContext';
import { customerAssistantApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';
import { premium, premiumSerif } from '../premiumTheme';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerAssistant'>;

// The Chakusa assistant. Thin client over /customer/ai/assistant/*: the AI
// Platform runs each turn server-side and only server-approved tools act.
// Welcome → chat (WhatsApp-style) → history; failures show a friendly retry,
// never a raw error code.

const PROMPTS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'calendar-outline', text: 'When is my next booking?' },
  { icon: 'cut-outline', text: 'Find a well-rated barber near me' },
  { icon: 'sparkles-outline', text: 'Recommend somewhere new to try' },
  { icon: 'heart-outline', text: 'Show my favourite places' },
];

type Mode = 'chat' | 'history';
interface Pending { id: string; text: string; at: string; failed: boolean }
const disclosure = aiDataSharingDisclosure('customerAssistant');

function friendly(caught: unknown): string {
  if (caught instanceof ApiError && (caught.code === 'AI_UNAVAILABLE' || caught.status === 503)) return 'The assistant is unavailable right now. Please try again in a moment.';
  if (caught instanceof ApiError && caught.status === 429) return 'That was a lot of questions at once. Wait a few seconds and try again.';
  if (caught instanceof ApiError && caught.kind === 'network') return 'You seem to be offline. Check your connection and try again.';
  return 'The assistant couldn’t answer just now. Please try again.';
}

export function CustomerAssistantScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { profile, user } = useCustomerAuth();
  const firstName = (profile?.displayName ?? user?.fullName ?? '').split(' ')[0];
  const [mode, setMode] = useState<Mode>('chat');
  const [activeId, setActiveId] = useState<string | null>(route.params?.conversationId ?? null);
  const [conversations, setConversations] = useState<CustomerAIConversationDto[]>([]);
  const [messages, setMessages] = useState<CustomerAIMessageDto[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [ratings, setRatings] = useState<Record<string, -1 | 0 | 1>>({});
  const [loadingThread, setLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  // A conversation this screen just created is already in local state; reloading it
  // mid-send would race the reply and show messages twice.
  const createdHere = useRef<string | null>(null);
  // Nothing reaches the AI provider until this person agrees (Guideline 5.1.2(i)).
  const [consent, setConsent] = useState<'loading' | 'needed' | 'given'>('loading');
  const userId = user?.id ?? null;
  useEffect(() => {
    let live = true;
    if (!userId) { setConsent('needed'); return; }
    void hasAiConsent('customerAssistant', userId).then((given) => { if (live) setConsent(given ? 'given' : 'needed'); });
    return () => { live = false; };
  }, [userId]);
  const agree = () => { setConsent('given'); if (userId) void recordAiConsent('customerAssistant', userId); };

  const loadList = useCallback(async () => {
    try { setConversations((await customerAssistantApi.listConversations({ limit: 30 })).items); } catch { /* history is optional */ }
  }, []);

  const loadThread = useCallback(async (id: string) => {
    setLoadingThread(true); setError(null);
    try {
      const thread = await customerAssistantApi.getConversation(id, { limit: 50 });
      setMessages(thread.messages);
      setRatings(Object.fromEntries(thread.messages.filter((m) => m.rating).map((m) => [m.id, m.rating as -1 | 0 | 1])));
    } catch { setError('Could not open this conversation.'); }
    finally { setLoadingThread(false); }
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (activeId && activeId !== createdHere.current) void loadThread(activeId); }, [activeId, loadThread]);

  const ask = async (text: string) => {
    const content = text.trim();
    if (!content || sendingRef.current || consent !== 'given') return;
    sendingRef.current = true; setSending(true); setError(null);
    setPending({ id: `pending-${Date.now()}`, text: content, at: new Date().toISOString(), failed: false });
    setDraft('');
    try {
      let id = activeId;
      if (!id) {
        const conversation = await customerAssistantApi.createConversation();
        id = conversation.id;
        createdHere.current = id;
        setActiveId(id);
        setConversations((current) => [conversation, ...current]);
      }
      const turn = await customerAssistantApi.sendMessage(id, content);
      setMessages((current) => [...current, turn.userMessage, turn.assistantMessage]);
      setPending(null);
    } catch (caught) {
      setPending((current) => (current ? { ...current, failed: true } : current));
      setError(friendly(caught));
    } finally {
      sendingRef.current = false; setSending(false);
    }
  };

  const retry = () => { if (pending) { const text = pending.text; setPending(null); void ask(text); } };

  const rate = async (messageId: string, rating: -1 | 1) => {
    const next = ratings[messageId] === rating ? 0 : rating;
    setRatings((current) => ({ ...current, [messageId]: next }));
    try { await customerAssistantApi.rateMessage(messageId, next); } catch { /* best-effort */ }
  };

  const startNew = () => { setActiveId(null); setMessages([]); setPending(null); setError(null); setMode('chat'); };

  const chat: ChatMessage[] = useMemo(() => {
    const shown = messages.filter((m) => m.role === 'user' || m.role === 'assistant').map((m): ChatMessage => ({
      id: m.id,
      text: m.content,
      mine: m.role === 'user',
      at: m.createdAt,
      footer: m.role === 'assistant' ? (
        <View style={styles.feedback}>
          <Pressable accessibilityRole="button" accessibilityLabel="Helpful" hitSlop={8} onPress={() => void rate(m.id, 1)}>
            <Ionicons name={ratings[m.id] === 1 ? 'thumbs-up' : 'thumbs-up-outline'} size={14} color={ratings[m.id] === 1 ? premium.deep : premium.inkFaint} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Not helpful" hitSlop={8} onPress={() => void rate(m.id, -1)}>
            <Ionicons name={ratings[m.id] === -1 ? 'thumbs-down' : 'thumbs-down-outline'} size={14} color={ratings[m.id] === -1 ? premium.danger : premium.inkFaint} />
          </Pressable>
        </View>
      ) : undefined,
    }));
    return pending ? [...shown, { id: pending.id, text: pending.text, mine: true, at: pending.at, failed: pending.failed }] : shown;
  }, [messages, pending, ratings]);

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} onPress={() => (mode === 'history' ? setMode('chat') : navigation.goBack())} style={styles.headerBtn}>
        <Ionicons name="chevron-back" size={24} color={premium.ink} />
      </Pressable>
      <View style={styles.avatar}><Ionicons name="sparkles" size={18} color={premium.onDeep} /></View>
      <View style={styles.headerCopy}>
        <Text style={styles.headerName}>{mode === 'history' ? 'Your conversations' : 'Chakusa assistant'}</Text>
        <Text numberOfLines={1} style={styles.headerHint}>{sending ? 'typing…' : 'AI · may make mistakes'}</Text>
      </View>
      {mode === 'chat' ? (
        <>
          <Pressable accessibilityRole="button" accessibilityLabel="Conversation history" hitSlop={8} onPress={() => { void loadList(); setMode('history'); }} style={styles.headerBtn}>
            <Ionicons name="time-outline" size={22} color={premium.ink} />
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="New conversation" hitSlop={8} onPress={startNew} style={styles.headerBtn}>
            <Ionicons name="create-outline" size={22} color={premium.ink} />
          </Pressable>
        </>
      ) : null}
    </View>
  );

  if (consent !== 'given') {
    return (
      <ChatLayout palette={customerChatPalette} header={header}>
        {consent === 'loading' ? <ActivityIndicator style={styles.flex} color={premium.deep} /> : (
          <ScrollView contentContainerStyle={styles.welcome}>
            <View style={styles.consent}>
              <View style={styles.consentIcon}><Ionicons name="shield-checkmark-outline" size={22} color={premium.deep} /></View>
              <Text accessibilityRole="header" style={styles.consentTitle}>{disclosure.title}</Text>
              <Text style={styles.consentBody}>{disclosure.body}</Text>
              <Pressable accessibilityRole="button" onPress={agree} style={({ pressed }) => [styles.consentAccept, pressed && styles.pressed]}>
                <Text style={styles.consentAcceptText}>{disclosure.accept}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={({ pressed }) => [styles.consentDecline, pressed && styles.pressed]}>
                <Text style={styles.consentDeclineText}>{disclosure.decline}</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </ChatLayout>
    );
  }

  if (mode === 'history') {
    return (
      <ChatLayout palette={customerChatPalette} header={header}>
        <ScrollView contentContainerStyle={styles.history}>
          {!conversations.length ? <Text style={styles.historyEmpty}>No conversations yet.</Text> : conversations.map((c) => (
            <Pressable key={c.id} accessibilityRole="button" onPress={() => { setActiveId(c.id); setPending(null); setMode('chat'); }} style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}>
              <View style={styles.historyIcon}><Ionicons name="chatbubble-ellipses-outline" size={18} color={premium.deep} /></View>
              <View style={styles.flex}>
                <Text numberOfLines={1} style={styles.historyTitle}>{c.title ?? 'Conversation'}</Text>
                <Text style={styles.historyMeta}>{formatDateTime(c.lastMessageAt ?? c.createdAt)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={premium.inkFaint} />
            </Pressable>
          ))}
        </ScrollView>
      </ChatLayout>
    );
  }

  const welcome = (
    <ScrollView contentContainerStyle={styles.welcome} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.heroBadge}><Ionicons name="sparkles" size={22} color={premium.gold} /></View>
        <Text style={styles.heroTitle}>{firstName ? `Hi ${firstName},` : 'Hi there,'}{'\n'}how can I help?</Text>
        <Text style={styles.heroBody}>Find great places, check your bookings and get ideas, in plain words.</Text>
      </View>
      <Text style={styles.promptsLabel}>TRY ASKING</Text>
      {PROMPTS.map((p) => (
        <Pressable key={p.text} accessibilityRole="button" disabled={sending} onPress={() => void ask(p.text)} style={({ pressed }) => [styles.prompt, pressed && styles.pressed]}>
          <View style={styles.promptIcon}><Ionicons name={p.icon} size={17} color={premium.deep} /></View>
          <Text style={styles.promptText}>{p.text}</Text>
          <Ionicons name="arrow-up-outline" size={16} color={premium.inkFaint} style={styles.promptArrow} />
        </Pressable>
      ))}
    </ScrollView>
  );

  const errorBar = error ? (
    <View style={styles.errorBar}>
      <Ionicons name="cloud-offline-outline" size={16} color={premium.danger} />
      <Text style={styles.errorText}>{error}</Text>
      {pending?.failed ? <Pressable accessibilityRole="button" onPress={retry} hitSlop={8}><Text style={styles.retry}>Retry</Text></Pressable> : null}
    </View>
  ) : null;

  return (
    <ChatLayout palette={customerChatPalette} header={header}>
      {loadingThread ? <ActivityIndicator style={styles.flex} color={premium.deep} /> : (
        <ChatThread messages={chat} palette={customerChatPalette} typing={sending} empty={welcome} footerNote={errorBar} />
      )}
      {!chat.length && errorBar}
      <ChatComposer value={draft} onChangeText={setDraft} onSend={() => void ask(draft)} sending={sending} placeholder="Ask the assistant" palette={customerChatPalette} />
    </ChatLayout>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingBottom: 8, backgroundColor: premium.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: premium.line },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: premium.deep, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, marginLeft: 4 },
  headerName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: premium.ink },
  headerHint: { fontFamily: 'Inter_400Regular', fontSize: 11.5, color: premium.inkFaint },
  welcome: { padding: 16, paddingBottom: 24, gap: 10 },
  hero: { backgroundColor: premium.deep, borderRadius: 24, padding: 22, marginBottom: 8 },
  heroBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(246,244,233,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  heroTitle: { fontFamily: premiumSerif, fontSize: 28, lineHeight: 34, color: premium.onDeep },
  heroBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: premium.onDeepSoft, marginTop: 8 },
  promptsLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.8, color: premium.inkFaint, marginTop: 6, marginLeft: 4 },
  prompt: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: premium.card, borderRadius: 18, borderWidth: 1, borderColor: premium.line, paddingHorizontal: 14, paddingVertical: 13 },
  promptIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: premium.sageSoft, alignItems: 'center', justifyContent: 'center' },
  promptText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14.5, color: premium.ink },
  promptArrow: { transform: [{ rotate: '45deg' }] },
  feedback: { flexDirection: 'row', gap: 14, paddingLeft: 10, paddingTop: 5 },
  errorBar: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', backgroundColor: premium.card, borderRadius: 14, borderWidth: 1, borderColor: premium.line, paddingHorizontal: 12, paddingVertical: 9, marginVertical: 8, marginHorizontal: 12 },
  errorText: { flexShrink: 1, fontFamily: 'Inter_400Regular', fontSize: 13, color: premium.ink },
  retry: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: premium.deep },
  history: { padding: 12, gap: 8 },
  historyEmpty: { fontFamily: 'Inter_400Regular', fontSize: 14, color: premium.inkSoft, textAlign: 'center', marginTop: 40 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: premium.card, borderRadius: 16, borderWidth: 1, borderColor: premium.line, padding: 14 },
  historyIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: premium.sageSoft, alignItems: 'center', justifyContent: 'center' },
  historyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14.5, color: premium.ink },
  historyMeta: { fontFamily: 'Inter_400Regular', fontSize: 12, color: premium.inkFaint, marginTop: 2 },
  pressed: { opacity: 0.7 },
  consent: { backgroundColor: premium.card, borderRadius: 24, borderWidth: 1, borderColor: premium.line, padding: 22, gap: 12 },
  consentIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: premium.sageSoft, alignItems: 'center', justifyContent: 'center' },
  consentTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 19, color: premium.ink },
  consentBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 21, color: premium.inkSoft },
  consentAccept: { backgroundColor: premium.deep, borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  consentAcceptText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: premium.onDeep },
  consentDecline: { paddingVertical: 10, alignItems: 'center' },
  consentDeclineText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: premium.inkSoft },
});
