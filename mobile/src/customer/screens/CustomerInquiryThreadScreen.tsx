import { Ionicons } from '../../components/icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { InquiryBusinessDto, InquiryMessageDto } from '../../apiTypes';
import { ProfilePhoto } from '../../components/ProfilePhoto';
import { ChatComposer, ChatLayout, ChatThread, type ChatMessage } from '../../components/chat/ChatKit';
import { customerChatPalette } from '../chatPalette';
import { ApiError } from '../../services/api';
import { inquiriesApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';
import { premium } from '../premiumTheme';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerInquiryThread'>;

// One conversation with a business. Opened from Messages (threadId) or from
// a business page (slug, no thread until the first message is sent).
// While open it checks for replies every few seconds; push covers the rest.

const POLL_MS = 8000;
const SUGGESTIONS = ['What are your prices?', 'Are you available this week?', 'Do you take walk-ins?'];

export function CustomerInquiryThreadScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const [threadId, setThreadId] = useState(route.params.threadId ?? null);
  const [business, setBusiness] = useState<InquiryBusinessDto | null>(route.params.businessName ? { name: route.params.businessName, slug: route.params.slug ?? null, photoUrl: null } : null);
  const [messages, setMessages] = useState<InquiryMessageDto[]>([]);
  const [loaded, setLoaded] = useState(!route.params.threadId);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!threadId) return;
    try {
      const thread = await inquiriesApi.get(threadId);
      setMessages(thread.messages);
      if (thread.business) setBusiness(thread.business);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load this conversation.');
    } finally {
      setLoaded(true);
    }
  }, [threadId]);

  useEffect(() => {
    void refresh();
    if (!threadId) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, threadId]);

  const send = async (text = draft) => {
    const body = text.trim();
    if (!body || sendingRef.current) return;
    sendingRef.current = true; setSending(true); setError(null);
    try {
      const result = threadId ? await inquiriesApi.send(threadId, body) : await inquiriesApi.start(route.params.slug!, body);
      setMessages((current) => [...current, result.message]);
      if (!threadId) setThreadId(result.threadId);
      setDraft('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Your message was not sent. Try again.');
    } finally {
      sendingRef.current = false; setSending(false);
    }
  };

  const chat: ChatMessage[] = messages.map((m) => ({ id: m.id, text: m.body, mine: !m.fromBusiness, at: m.createdAt }));

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} hitSlop={10} style={styles.headerBtn}>
        <Ionicons name="chevron-back" size={24} color={premium.ink} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${business?.name ?? 'business'}`} disabled={!business?.slug} onPress={() => business?.slug && navigation.navigate('BusinessProfile', { slug: business.slug })} style={styles.headerCenter}>
        <ProfilePhoto uri={business?.photoUrl} name={business?.name} size={38} />
        <View style={styles.flex}>
          <Text style={styles.headerName} numberOfLines={1}>{business?.name ?? 'Conversation'}</Text>
          <Text style={styles.headerHint}>Replies arrive here and as a notification</Text>
        </View>
      </Pressable>
    </View>
  );

  return (
    <ChatLayout palette={customerChatPalette} header={header}>
      {!loaded ? <ActivityIndicator style={styles.spinner} color={premium.deep} /> : (
        <ChatThread
          messages={chat}
          palette={customerChatPalette}
          footerNote={error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          empty={
            <View style={styles.intro}>
              <View style={styles.introIcon}><Ionicons name="chatbubbles-outline" size={26} color={premium.deep} /></View>
              <Text style={styles.introTitle}>Ask {business?.name ?? 'the business'} anything</Text>
              <Text style={styles.introBody}>Prices, availability, what to bring. They reply here and you'll get a notification.</Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s} accessibilityRole="button" onPress={() => void send(s)} disabled={sending} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
                    <Text style={styles.suggestionText}>{s}</Text>
                    <Ionicons name="arrow-forward" size={15} color={premium.deep} />
                  </Pressable>
                ))}
              </View>
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            </View>
          }
        />
      )}
      <ChatComposer value={draft} onChangeText={setDraft} onSend={() => void send()} sending={sending} disabled={!threadId && !route.params.slug} placeholder="Write a message" palette={customerChatPalette} />
    </ChatLayout>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: premium.line, backgroundColor: premium.card },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: premium.ink },
  headerHint: { fontFamily: 'Inter_400Regular', fontSize: 11.5, color: premium.inkFaint },
  spinner: { flex: 1 },
  intro: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, paddingHorizontal: 24 },
  introIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: premium.sage, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  introTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: premium.ink, textAlign: 'center' },
  introBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: premium.inkSoft, textAlign: 'center' },
  suggestions: { gap: 8, marginTop: 12, alignSelf: 'stretch' },
  suggestion: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: premium.line, backgroundColor: premium.card, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  suggestionText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: premium.deep },
  pressed: { opacity: 0.7 },
  error: { fontFamily: 'Inter_500Medium', fontSize: 13, color: premium.danger, textAlign: 'center', paddingVertical: 6 },
});
