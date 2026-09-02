import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, LoadingState, PrimaryButton, Screen } from '../../components/ui';
import type { CustomerAIConversationDto, CustomerAIMessageDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDateTime } from '../../utils/format';
import { customerAssistantApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerAssistant'>;

// PROGRAM 2 LOOP 7: the Customer AI Assistant entry point. Thin client over
// `/customer/ai/assistant/*` — the AI Platform runs the turn server-side.
// Shown only because `/customer/dashboard` reports the entry is enabled
// (Home guards the link); this screen also degrades gracefully if a call
// is refused.

export function CustomerAssistantScreen({ route }: Props) {
  const initialId = route.params?.conversationId ?? null;
  const [conversations, setConversations] = useState<CustomerAIConversationDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(initialId);
  const [messages, setMessages] = useState<CustomerAIMessageDto[]>([]);
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
    try { setMessages((await customerAssistantApi.getConversation(id, { limit: 50 })).messages); }
    catch (caught) { setThreadError(caught instanceof ApiError ? caught.message : 'Could not load this conversation.'); }
    finally { setLoadingThread(false); }
  }, []);

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
      <Screen refreshing={loadedList && !listError} onRefresh={() => void loadList()}>
        <AppHeader eyebrow="ASSISTANT" title="Chakusa assistant" subtitle="Ask about businesses, availability, or your bookings." />
        <PrimaryButton fullWidth icon="add" label="New conversation" onPress={() => setActiveId('')} />
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
    <Screen scroll={false}>
      <AppHeader
        eyebrow="ASSISTANT"
        title="Chakusa assistant"
        right={
          <Pressable accessibilityRole="button" accessibilityLabel="All conversations" hitSlop={8} onPress={() => setActiveId(null)}>
            <Ionicons name="list" size={22} color={colors.text} />
          </Pressable>
        }
      />
      <ScrollView ref={scrollRef} style={styles.thread} contentContainerStyle={styles.threadContent} keyboardShouldPersistTaps="handled">
        {loadingThread ? <LoadingState label="Loading…" /> : null}
        {messages.filter((message) => message.role !== 'tool').map((message) => (
          <View key={message.id} style={[styles.bubble, message.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
            <Text style={[styles.bubbleText, message.role === 'user' && styles.bubbleTextUser]}>{message.content}</Text>
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
          placeholderTextColor={colors.textSecondary}
          multiline
        />
        <PrimaryButton compact label={sending ? '…' : 'Send'} disabled={sending || !draft.trim()} onPress={() => void send()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  convo: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xxs },
  pressed: { opacity: 0.78 },
  convoTitle: { ...typography.bodyStrong, color: colors.text },
  convoMeta: { ...typography.caption, color: colors.textSecondary },
  thread: { flex: 1 },
  threadContent: { gap: spacing.xs, paddingBottom: spacing.md },
  bubble: { maxWidth: '86%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: colors.primary },
  bubbleAssistant: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  bubbleText: { ...typography.body, color: colors.text },
  bubbleTextUser: { color: colors.surface },
  hint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.lg },
  error: { ...typography.caption, color: colors.negative },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs, paddingTop: spacing.xs, borderTopWidth: 1, borderTopColor: colors.border },
  composerInput: { flex: 1, maxHeight: 120, minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, paddingTop: spacing.sm, ...typography.body, color: colors.text },
});
