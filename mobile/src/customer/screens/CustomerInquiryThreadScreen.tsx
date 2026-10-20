import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { InquiryBusinessDto, InquiryMessageDto } from '../../apiTypes';
import { ProfilePhoto } from '../../components/ProfilePhoto';
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
  const listRef = useRef<FlatList<InquiryMessageDto>>(null);

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

  const canSend = Boolean(draft.trim()) && !sending && (Boolean(threadId) || Boolean(route.params.slug));

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={24} color={premium.ink} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${business?.name ?? 'business'}`} disabled={!business?.slug} onPress={() => business?.slug && navigation.navigate('BusinessProfile', { slug: business.slug })} style={styles.headerCenter}>
          <ProfilePhoto uri={business?.photoUrl} name={business?.name} size={36} />
          <View style={styles.flex}>
            <Text style={styles.headerName} numberOfLines={1}>{business?.name ?? 'Conversation'}</Text>
            <Text style={styles.headerHint}>Usually replies in the app</Text>
          </View>
        </Pressable>
      </View>

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {!loaded ? <ActivityIndicator style={styles.spinner} color={premium.deep} /> : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={styles.messages}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
            ListEmptyComponent={
              <View style={styles.intro}>
                <Text style={styles.introTitle}>Ask {business?.name ?? 'the business'} anything</Text>
                <Text style={styles.introBody}>Prices, availability, what to bring. They reply here and you'll get a notification.</Text>
                <View style={styles.suggestions}>
                  {SUGGESTIONS.map((s) => (
                    <Pressable key={s} accessibilityRole="button" onPress={() => void send(s)} disabled={sending} style={styles.suggestion}>
                      <Text style={styles.suggestionText}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            }
            renderItem={({ item }) => (
              <View style={[styles.bubbleRow, !item.fromBusiness && styles.mine]}>
                <View style={[styles.bubble, item.fromBusiness ? styles.theirs : styles.ours]}>
                  <Text style={[styles.bubbleText, !item.fromBusiness && styles.oursText]}>{item.body}</Text>
                  <Text style={[styles.bubbleTime, !item.fromBusiness && styles.oursTime]}>{new Date(item.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</Text>
                </View>
              </View>
            )}
          />
        )}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          <TextInput
            accessibilityLabel="Message"
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message…"
            placeholderTextColor={premium.inkFaint}
            multiline
            maxLength={2000}
            style={styles.input}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Send" disabled={!canSend} onPress={() => void send()} style={[styles.sendBtn, !canSend && styles.sendDisabled]}>
            {sending ? <ActivityIndicator color={premium.onDeep} size="small" /> : <Ionicons name="arrow-up" size={20} color={premium.onDeep} />}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: premium.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: premium.line, backgroundColor: premium.card },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: premium.ink },
  headerHint: { fontFamily: 'Inter_400Regular', fontSize: 11, color: premium.inkFaint },
  spinner: { marginTop: 40 },
  messages: { padding: 16, gap: 8, flexGrow: 1 },
  intro: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  introTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: premium.ink, textAlign: 'center' },
  introBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: premium.inkSoft, textAlign: 'center' },
  suggestions: { gap: 8, marginTop: 12, alignSelf: 'stretch' },
  suggestion: { borderWidth: 1, borderColor: premium.line, backgroundColor: premium.card, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 11 },
  suggestionText: { fontFamily: 'Inter_500Medium', fontSize: 14, color: premium.deep },
  bubbleRow: { flexDirection: 'row' },
  mine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20, gap: 4 },
  theirs: { backgroundColor: premium.card, borderWidth: 1, borderColor: premium.line, borderBottomLeftRadius: 6 },
  ours: { backgroundColor: premium.deep, borderBottomRightRadius: 6 },
  bubbleText: { fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 21, color: premium.ink },
  oursText: { color: premium.onDeep },
  bubbleTime: { fontFamily: 'Inter_400Regular', fontSize: 10, color: premium.inkFaint, alignSelf: 'flex-end' },
  oursTime: { color: premium.onDeepSoft },
  error: { fontFamily: 'Inter_500Medium', fontSize: 13, color: premium.danger, paddingHorizontal: 16, paddingBottom: 6 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: premium.line, backgroundColor: premium.card },
  input: { flex: 1, maxHeight: 120, minHeight: 44, borderRadius: 22, backgroundColor: premium.bg, borderWidth: 1, borderColor: premium.line, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontFamily: 'Inter_400Regular', fontSize: 15, color: premium.ink },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: premium.deep, alignItems: 'center', justifyContent: 'center' },
  sendDisabled: { opacity: 0.4 },
});
