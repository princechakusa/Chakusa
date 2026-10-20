import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { InquiryThreadSummaryDto } from '../../apiTypes';
import { ProfilePhoto } from '../../components/ProfilePhoto';
import { ApiError } from '../../services/api';
import { inquiriesApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';
import { premium, premiumSerif } from '../premiumTheme';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;

/** "14:05" today, "Mon" this week, otherwise "12 Oct". */
export function threadTime(iso: string, now = new Date()) {
  const date = new Date(iso);
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (now.getTime() - date.getTime() < 6 * 86_400_000) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function CustomerInquiriesScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [threads, setThreads] = useState<InquiryThreadSummaryDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setThreads(await inquiriesApi.list()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load your messages.'); }
    finally { setLoaded(true); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8 }]}>
      <Text style={styles.eyebrow}>MESSAGES</Text>
      <Text style={styles.title}>Your <Text style={styles.serif}>conversations.</Text></Text>
      {!loaded ? <ActivityIndicator style={styles.spinner} color={premium.deep} /> : (
        <FlatList
          data={threads}
          keyExtractor={(t) => t.id}
          contentContainerStyle={threads.length ? styles.list : styles.emptyWrap}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={premium.deep} />}
          ListHeaderComponent={error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Ionicons name="chatbubbles-outline" size={28} color={premium.deep} /></View>
              <Text style={styles.emptyTitle}>No conversations yet</Text>
              <Text style={styles.emptyBody}>Ask a business about prices, availability or anything else from its page in Explore.</Text>
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate('CustomerTabs', { screen: 'CustomerExplore' })} style={styles.emptyCta}>
                <Text style={styles.emptyCtaText}>Explore businesses</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => {
            const unread = item.unreadCount > 0;
            const last = item.lastMessage;
            return (
              <Pressable accessibilityRole="button" accessibilityLabel={`${item.business?.name ?? 'Business'}${unread ? `, ${item.unreadCount} unread` : ''}`} onPress={() => navigation.navigate('CustomerInquiryThread', { threadId: item.id, businessName: item.business?.name, slug: item.business?.slug ?? undefined })} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <ProfilePhoto uri={item.business?.photoUrl} name={item.business?.name} size={52} />
                <View style={styles.rowBody}>
                  <View style={styles.rowTop}>
                    <Text style={[styles.name, unread && styles.bold]} numberOfLines={1}>{item.business?.name ?? 'Business'}</Text>
                    {last ? <Text style={[styles.time, unread && styles.timeUnread]}>{threadTime(last.createdAt)}</Text> : null}
                  </View>
                  <View style={styles.rowTop}>
                    <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>{last ? `${last.fromBusiness ? '' : 'You: '}${last.body}` : ''}</Text>
                    {unread ? <View style={styles.badge}><Text style={styles.badgeText}>{item.unreadCount}</Text></View> : null}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: premium.bg, paddingHorizontal: 16 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1.6, color: premium.inkFaint },
  title: { fontFamily: 'PlusJakartaSans_800ExtraBold', fontSize: 30, letterSpacing: -1, color: premium.ink, marginBottom: 12 },
  serif: { fontFamily: premiumSerif, fontStyle: 'italic', fontWeight: '400', fontSize: 34 },
  spinner: { marginTop: 40 },
  list: { paddingBottom: 32 },
  emptyWrap: { flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: premium.line },
  pressed: { opacity: 0.7 },
  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15, color: premium.ink },
  bold: { fontFamily: 'PlusJakartaSans_700Bold' },
  time: { fontFamily: 'Inter_400Regular', fontSize: 12, color: premium.inkFaint },
  timeUnread: { color: premium.deep, fontFamily: 'Inter_600SemiBold' },
  preview: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, color: premium.inkSoft },
  previewUnread: { color: premium.ink, fontFamily: 'Inter_500Medium' },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: premium.deep, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: premium.onDeep },
  error: { fontFamily: 'Inter_500Medium', fontSize: 13, color: premium.danger, marginBottom: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24, paddingBottom: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: premium.sage, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  emptyTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: premium.ink },
  emptyBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: premium.inkSoft, textAlign: 'center' },
  emptyCta: { marginTop: 10, backgroundColor: premium.deep, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 999 },
  emptyCtaText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: premium.onDeep },
});
