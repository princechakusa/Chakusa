import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CustomerNotificationCategory, CustomerNotificationDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { loyaltyNotificationTarget } from '../domain/customerLoyalty';
import { customerApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';
import { premium, premiumSerif } from '../premiumTheme';
import { enableCustomerPush, getCustomerPushStatus } from '../push';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;
type Filter = 'all' | 'unread';
type IconName = keyof typeof Ionicons.glyphMap;

// Customer notifications: one calm, premium feed. Grouped by when it
// happened, tap opens the thing it is about (conversation, booking,
// assistant reply, reward), unread items carry a soft tint and a dot.

const CATEGORY: Record<string, { icon: IconName; tint: string; bg: string }> = {
  booking_update: { icon: 'calendar', tint: '#2F6B5E', bg: '#E3EFEA' },
  appointment_reminder: { icon: 'alarm', tint: '#2F6B5E', bg: '#E3EFEA' },
  message: { icon: 'chatbubble-ellipses', tint: '#2D5C8A', bg: '#E4ECF5' },
  ai_reply: { icon: 'sparkles', tint: '#7A5A1E', bg: '#F5ECD9' },
  promotion: { icon: 'pricetag', tint: '#9A4A3A', bg: '#F7E6E1' },
  review_reminder: { icon: 'star', tint: '#A0761C', bg: '#F7EDD3' },
  loyalty: { icon: 'gift', tint: '#7B4B8F', bg: '#EFE5F3' },
  legal_update: { icon: 'document-text', tint: premium.inkSoft, bg: premium.sageSoft },
};
const look = (category: CustomerNotificationCategory) => CATEGORY[category] ?? { icon: 'notifications' as IconName, tint: premium.deep, bg: premium.sageSoft };

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function sectionOf(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  if (now.getTime() - d.getTime() < 7 * 86_400_000) return 'This week';
  return 'Earlier';
}

export function CustomerNotificationsScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<CustomerNotificationDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [pushStatus, setPushStatus] = useState<'granted' | 'denied' | 'undetermined' | 'unsupported'>('undetermined');
  const [enabling, setEnabling] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await customerApi.notifications()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load notifications.'); }
    finally { setLoaded(true); setRefreshing(false); }
  }, []);

  useEffect(() => { void load(); void getCustomerPushStatus().then(setPushStatus); }, [load]);

  const turnOn = async () => {
    setEnabling(true);
    try {
      const result = await enableCustomerPush();
      setPushStatus(result === 'registered' ? 'granted' : result === 'denied' ? 'denied' : pushStatus);
    } finally { setEnabling(false); }
  };

  const markRead = async (id: string) => {
    setItems((current) => current.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    try { await customerApi.markNotificationRead(id); } catch { void load(); }
  };

  const markAll = async () => {
    setItems((current) => current.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    try { await customerApi.markAllNotificationsRead(); } catch { void load(); }
  };

  // Every destination is inside the customer app; ids come from our own server.
  const open = (n: CustomerNotificationDto) => {
    if (!n.readAt) void markRead(n.id);
    const data = n.data ?? {};
    const str = (key: string) => (typeof data[key] === 'string' ? (data[key] as string) : undefined);
    if (n.category === 'loyalty') {
      const target = loyaltyNotificationTarget(n);
      if (target.route === 'CustomerLoyaltyBusiness') navigation.navigate('CustomerLoyaltyBusiness', { businessId: target.businessId });
      else navigation.navigate(target.route);
    } else if (n.category === 'message' && str('threadId')) {
      navigation.navigate('CustomerInquiryThread', { threadId: str('threadId'), slug: str('slug'), businessName: n.title });
    } else if (n.category === 'ai_reply') {
      navigation.navigate('CustomerAssistant', str('conversationId') ? { conversationId: str('conversationId') } : undefined);
    } else if ((n.category === 'booking_update' || n.category === 'appointment_reminder') && str('appointmentId')) {
      navigation.navigate('BookingDetail', { bookingId: str('appointmentId')! });
    }
  };

  const unread = items.filter((n) => !n.readAt).length;
  const sections = useMemo(() => {
    const shown = filter === 'unread' ? items.filter((n) => !n.readAt) : items;
    const order = ['Today', 'This week', 'Earlier'];
    return order.map((title) => ({ title, data: shown.filter((n) => sectionOf(n.createdAt) === title) })).filter((s) => s.data.length);
  }, [items, filter]);

  const header = (
    <View>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>{unread ? `${unread} new` : 'You’re all caught up'}</Text>
        </View>
        {unread ? (
          <Pressable accessibilityRole="button" onPress={() => void markAll()} hitSlop={8} style={({ pressed }) => [styles.markAll, pressed && styles.pressed]}>
            <Ionicons name="checkmark-done" size={16} color={premium.deep} />
            <Text style={styles.markAllText}>Mark all read</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.filters}>
        {(['all', 'unread'] as Filter[]).map((f) => (
          <Pressable key={f} accessibilityRole="button" accessibilityState={{ selected: filter === f }} onPress={() => setFilter(f)} style={[styles.chip, filter === f && styles.chipOn]}>
            <Text style={[styles.chipText, filter === f && styles.chipTextOn]}>{f === 'all' ? 'All' : `Unread${unread ? ` · ${unread}` : ''}`}</Text>
          </Pressable>
        ))}
      </View>
      {pushStatus !== 'granted' && pushStatus !== 'unsupported' ? (
        <View style={styles.push}>
          <View style={styles.pushIcon}><Ionicons name="notifications" size={18} color={premium.gold} /></View>
          <View style={styles.flex}>
            <Text style={styles.pushTitle}>{pushStatus === 'denied' ? 'Notifications are off' : 'Never miss a reply'}</Text>
            <Text style={styles.pushBody}>{pushStatus === 'denied' ? 'Turn them on in your phone’s Settings to get booking updates.' : 'Get booking updates, reminders and replies instantly.'}</Text>
          </View>
          {pushStatus !== 'denied' ? (
            <Pressable accessibilityRole="button" disabled={enabling} onPress={() => void turnOn()} style={({ pressed }) => [styles.pushBtn, pressed && styles.pressed]}>
              {enabling ? <ActivityIndicator size="small" color={premium.deep} /> : <Text style={styles.pushBtnText}>Turn on</Text>}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" hitSlop={10} onPress={() => navigation.goBack()} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={24} color={premium.ink} />
        </Pressable>
      </View>
      {!loaded ? <ActivityIndicator style={styles.flex} color={premium.deep} /> : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => n.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 24 }]}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={premium.deep} colors={[premium.deep]} onRefresh={() => { setRefreshing(true); void load(); }} />}
          ListHeaderComponent={header}
          ListEmptyComponent={
            error ? (
              <View style={styles.empty}>
                <Ionicons name="cloud-offline-outline" size={30} color={premium.inkFaint} />
                <Text style={styles.emptyTitle}>Couldn’t load notifications</Text>
                <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={styles.markAllText}>Try again</Text></Pressable>
              </View>
            ) : (
              <View style={styles.empty}>
                <View style={styles.emptyIcon}><Ionicons name="notifications-outline" size={28} color={premium.deep} /></View>
                <Text style={styles.emptyTitle}>{filter === 'unread' ? 'Nothing new' : 'Nothing here yet'}</Text>
                <Text style={styles.emptyBody}>Booking updates, reminders and replies from businesses will appear here.</Text>
              </View>
            )
          }
          renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title.toUpperCase()}</Text>}
          renderItem={({ item: n }) => {
            const l = look(n.category);
            return (
              <Pressable accessibilityRole="button" accessibilityLabel={`${n.title}. ${n.body}. ${n.readAt ? 'Read' : 'Unread'}`} onPress={() => open(n)} style={({ pressed }) => [styles.item, !n.readAt && styles.itemUnread, pressed && styles.pressed]}>
                <View style={[styles.itemIcon, { backgroundColor: l.bg }]}><Ionicons name={l.icon} size={18} color={l.tint} /></View>
                <View style={styles.itemCopy}>
                  <View style={styles.itemTop}>
                    <Text numberOfLines={1} style={[styles.itemTitle, !n.readAt && styles.itemTitleUnread]}>{n.title}</Text>
                    <Text style={styles.itemTime}>{ago(n.createdAt)}</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.itemBody}>{n.body}</Text>
                </View>
                {!n.readAt ? <View style={styles.dot} /> : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: premium.bg },
  nav: { height: 44, justifyContent: 'center', paddingHorizontal: 8 },
  navBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 14 },
  title: { fontFamily: premiumSerif, fontSize: 32, lineHeight: 38, color: premium.ink },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: premium.inkSoft, marginTop: 2 },
  markAll: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: premium.sageSoft },
  markAllText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: premium.deep },
  filters: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: premium.line, backgroundColor: premium.card },
  chipOn: { backgroundColor: premium.deep, borderColor: premium.deep },
  chipText: { fontFamily: 'Inter_500Medium', fontSize: 13.5, color: premium.ink },
  chipTextOn: { color: premium.onDeep },
  push: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: premium.deep, borderRadius: 20, padding: 14, marginBottom: 6 },
  pushIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(246,244,233,0.12)', alignItems: 'center', justifyContent: 'center' },
  pushTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: premium.onDeep },
  pushBody: { fontFamily: 'Inter_400Regular', fontSize: 12.5, lineHeight: 17, color: premium.onDeepSoft, marginTop: 1 },
  pushBtn: { minWidth: 76, height: 36, borderRadius: 18, backgroundColor: premium.onDeep, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  pushBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: premium.deep },
  section: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.9, color: premium.inkFaint, marginTop: 18, marginBottom: 8, marginLeft: 4 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: premium.card, borderRadius: 18, borderWidth: 1, borderColor: premium.line, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8 },
  itemUnread: { backgroundColor: '#FBFAF3', borderColor: premium.sage },
  itemIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  itemCopy: { flex: 1, minWidth: 0 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  itemTitle: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14.5, color: premium.ink },
  itemTitleUnread: { fontFamily: 'Inter_600SemiBold' },
  itemTime: { fontFamily: 'Inter_400Regular', fontSize: 12, color: premium.inkFaint },
  itemBody: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: premium.inkSoft, marginTop: 2 },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: premium.gold },
  pressed: { opacity: 0.75 },
  empty: { alignItems: 'center', gap: 8, paddingTop: 48, paddingHorizontal: 24 },
  emptyIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: premium.sage, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  emptyTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: premium.ink },
  emptyBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: premium.inkSoft, textAlign: 'center' },
});
