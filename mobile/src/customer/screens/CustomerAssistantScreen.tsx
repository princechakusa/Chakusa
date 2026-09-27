import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { CustomerAIConversationDto, CustomerAIMessageDto } from '../../apiTypes';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { formatDateTime } from '../../utils/format';
import { customerAssistantApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerAssistant'>;

// PROGRAM 2 LOOP 7: the Customer AI Assistant entry point. Thin client over
// `/customer/ai/assistant/*` - the AI Platform runs the turn server-side.
// Shown only because `/customer/dashboard` reports the entry is enabled
// (Home guards the link); this screen also degrades gracefully if a call
// is refused.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function PrimaryBtn({ label, icon, compact, disabled, onPress }: { label: string; icon?: keyof typeof Ionicons.glyphMap; compact?: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryBtn, compact && styles.primaryBtnCompact, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      {icon ? <Ionicons name={icon} size={17} color={authColors.onCoral} /> : null}
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

export function CustomerAssistantScreen({ route }: Props) {
  const initialId = route.params?.conversationId ?? null;
  const [conversations, setConversations] = useState<CustomerAIConversationDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialId);
  const [messages, setMessages] = useState<CustomerAIMessageDto[]>([]);
  const [ratings, setRatings] = useState<Record<string, -1 | 0 | 1>>({});
  const [listError, setListError] = useState<string | null>(null);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [loadedList, setLoadedList] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const loadList = useCallback(async () => {
    try { setConversations((await customerAssistantApi.listConversations({ limit: 30 })).items); setListError(null); }
    catch (caught) { setListError(caught instanceof ApiError ? caught.message : 'Could not load your conversations.'); }
    finally { setLoadedList(true); }
  }, []);

  const loadThread = useCallback(async (id: string) => {
    setLoadingThread(true);
    setThreadError(null);
    try {
      const thread = await customerAssistantApi.getConversation(id, { limit: 50 });
      setMessages(thread.messages);
      setRatings(Object.fromEntries(thread.messages.filter((m) => m.rating).map((m) => [m.id, m.rating as -1 | 0 | 1])));
    } catch (caught) {
      setThreadError(caught instanceof ApiError ? caught.message : 'Could not load this conversation.');
    } finally {
      setLoadingThread(false);
    }
  }, []);

  const rate = async (messageId: string, rating: -1 | 1) => {
    const next = ratings[messageId] === rating ? 0 : rating;
    setRatings((current) => ({ ...current, [messageId]: next }));
    try { await customerAssistantApi.rateMessage(messageId, next); } catch { /* best-effort */ }
  };

  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => { if (activeId) void loadThread(activeId); else setMessages([]); }, [activeId, loadThread]);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setThreadError(null);
    try {
      let id = activeId;
      if (!id) {
        const conversation = await customerAssistantApi.createConversation();
        id = conversation.id;
        setActiveId(id);
        setConversations((current) => [conversation, ...current]);
      }
      const turn = await customerAssistantApi.sendMessage(id, content);
      setMessages((current) => [...current, turn.userMessage, turn.assistantMessage]);
      setDraft('');
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (caught) {
      setThreadError(caught instanceof ApiError ? caught.message : 'The assistant couldn’t respond. Please try again.');
    } finally {
      setSending(false);
    }
  };

  if (activeId === null) {
    return (
      <Screen backgroundColor={authColors.bg} refreshing={loadedList && !listError} onRefresh={() => void loadList()}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>ASSISTANT</Text>
          <Text style={styles.title}>Chakusa assistant</Text>
          <Text style={styles.subtitle}>Ask about businesses, availability, or your bookings.</Text>
        </View>
        <PrimaryBtn icon="add" label="New conversation" onPress={() => setActiveId('')} />
        {!loadedList ? <LoadingState label="Loading…" />
          : listError ? <ErrorState message={listError} onRetry={() => void loadList()} />
          : !conversations.length ? <EmptyState icon="chatbubbles-outline" title="No conversations yet" message="Start one to get personalised help finding and booking businesses." />
          : (
            <View style={styles.list}>
              {conversations.map((conversation) => (
                <Pressable key={conversation.id} accessibilityRole="button" onPress={() => setActiveId(conversation.id)} style={({ pressed }) => [styles.convo, pressed && styles.pressed]}>
                  <Text style={styles.convoTitle} numberOfLines={1}>{conversation.title ?? 'Conversation'}</Text>
                  <Text style={styles.convoMeta}>{conversation.messageCount} message{conversation.messageCount === 1 ? '' : 's'} · {formatDateTime(conversation.lastMessageAt ?? conversation.createdAt)}</Text>
                </Pressable>
              ))}
            </View>
          )}
      </Screen>
    );
  }

  return (
    <Screen backgroundColor={authColors.bg} scroll={false}>
      <View style={styles.threadHeader}>
        <View>
          <Text style={styles.eyebrow}>ASSISTANT</Text>
          <Text style={styles.title}>Chakusa assistant</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="All conversations" hitSlop={8} onPress={() => setActiveId(null)} style={styles.iconBtn}>
          <Ionicons name="list" size={19} color={authColors.ink} />
        </Pressable>
      </View>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          keyboardShouldPersistTaps="handled"
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {loadingThread ? <LoadingState label="Loading…" /> : null}
          {messages.filter((message) => message.role !== 'tool').map((message) => (
            <View key={message.id} style={message.role === 'user' ? styles.bubbleRowUser : styles.bubbleRowAssistant}>
              <View style={[styles.bubble, message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
                <Text style={[styles.bubbleText, message.role === 'user' && styles.bubbleTextUser]}>{message.content}</Text>
              </View>
              {message.role === 'assistant' ? (
                <View style={styles.feedbackRow}>
                  <Pressable accessibilityRole="button" accessibilityLabel="Helpful" hitSlop={8} onPress={() => void rate(message.id, 1)}>
                    <Ionicons name={ratings[message.id] === 1 ? 'thumbs-up' : 'thumbs-up-outline'} size={15} color={ratings[message.id] === 1 ? authColors.positive : authColors.inkSoft} />
                  </Pressable>
                  <Pressable accessibilityRole="button" accessibilityLabel="Not helpful" hitSlop={8} onPress={() => void rate(message.id, -1)}>
                    <Ionicons name={ratings[message.id] === -1 ? 'thumbs-down' : 'thumbs-down-outline'} size={15} color={ratings[message.id] === -1 ? authColors.danger : authColors.inkSoft} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}
          {!loadingThread && !messages.length ? <Text style={styles.hint}>Ask something like “Find a highly-rated barber near me for Saturday morning.”</Text> : null}
          {threadError ? <Text style={styles.error}>{threadError}</Text> : null}
        </ScrollView>
        <View style={styles.composer}>
          <TextInput
            style={styles.composerInput}
            value={draft}
            onChangeText={setDraft}
            placeholder="Message the assistant"
            placeholderTextColor={authColors.inkFaint}
            multiline
          />
          <PrimaryBtn compact label={sending ? '…' : 'Send'} disabled={sending || !draft.trim()} onPress={() => void send()} />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  threadHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: authSpace.sm },
  iconBtn: { width: 36, height: 36, borderRadius: authRadius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.line },
  list: { gap: authSpace.xs },
  convo: { padding: authSpace.md, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, gap: authSpace.xxs, ...authShadow.card },
  pressed: { opacity: 0.78 },
  convoTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  convoMeta: { ...authType.body, fontSize: 12 },
  thread: { flex: 1 },
  threadContent: { gap: authSpace.xs, paddingBottom: authSpace.md },
  bubbleRowUser: { alignItems: 'flex-end' },
  bubbleRowAssistant: { alignItems: 'flex-start', gap: authSpace.xxs },
  bubble: { maxWidth: '86%', paddingHorizontal: authSpace.md, paddingVertical: authSpace.sm, borderRadius: authRadius.lg },
  bubbleUser: { backgroundColor: authColors.coral },
  bubbleAssistant: { backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.line },
  bubbleText: { ...authType.body, fontSize: 14, color: authColors.ink },
  bubbleTextUser: { color: authColors.onCoral },
  feedbackRow: { flexDirection: 'row', gap: authSpace.sm, paddingLeft: authSpace.sm },
  hint: { ...authType.body, fontSize: 13, textAlign: 'center', paddingVertical: authSpace.lg },
  error: { ...authType.body, fontSize: 12, color: authColors.danger },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: authSpace.xs, paddingTop: authSpace.xs, borderTopWidth: 1, borderTopColor: authColors.line },
  composerInput: { flex: 1, maxHeight: 120, minHeight: 44, borderRadius: authRadius.md, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.bgSunk, paddingHorizontal: authSpace.md, paddingTop: authSpace.sm, ...authType.body, fontSize: 15, color: authColors.ink },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs, minHeight: 52, borderRadius: authRadius.pill, backgroundColor: authColors.coral, ...authShadow.cta },
  primaryBtnCompact: { minHeight: 44, minWidth: 72, paddingHorizontal: authSpace.md, flex: 0, alignSelf: 'flex-end' },
  primaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.onCoral },
  disabled: { opacity: 0.5 },
});
