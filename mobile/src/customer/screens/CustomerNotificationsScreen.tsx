import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { CustomerNotificationCategory, CustomerNotificationDto } from '../../apiTypes';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { formatDateTime } from '../../utils/format';
import { loyaltyNotificationTarget } from '../domain/customerLoyalty';
import { customerApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';
import { enableCustomerPush, getCustomerPushStatus } from '../push';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;

// PROGRAM 2 LOOP 7: notifications list + the device-registration entry
// point. Reads `/customer/notifications`; the "Turn on" button asks for OS
// permission and registers the Expo token against `/customer/auth/devices`.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

export function CustomerNotificationsScreen() {
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<CustomerNotificationDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pushStatus, setPushStatus] = useState<'granted' | 'denied' | 'undetermined' | 'unsupported'>('undetermined');
  const [enabling, setEnabling] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await customerApi.notifications()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load notifications.'); }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => { void load(); void getCustomerPushStatus().then(setPushStatus); }, [load]);

  const turnOn = async () => {
    setEnabling(true);
    try {
      const result = await enableCustomerPush();
      setPushStatus(result === 'registered' ? 'granted' : result === 'denied' ? 'denied' : pushStatus);
    } finally {
      setEnabling(false);
    }
  };

  const markRead = async (id: string) => {
    setItems((current) => current.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
    try { await customerApi.markNotificationRead(id); } catch { void load(); }
  };

  const markAll = async () => {
    setItems((current) => current.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
    try { await customerApi.markAllNotificationsRead(); } catch { void load(); }
  };

  // A loyalty notification tap deep-links inside the customer app only.
  // `loyaltyNotificationTarget` never returns a business-owner destination.
  const openNotification = (notification: CustomerNotificationDto) => {
    if (!notification.readAt) void markRead(notification.id);
    if (notification.category !== 'loyalty') return;
    const target = loyaltyNotificationTarget(notification);
    if (target.route === 'CustomerLoyaltyBusiness') navigation.navigate('CustomerLoyaltyBusiness', { businessId: target.businessId });
    else navigation.navigate(target.route);
  };

  const unread = items.filter((n) => !n.readAt).length;

  return (
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>NOTIFICATIONS</Text>
        <Text style={styles.title}>Updates</Text>
        <Text style={styles.subtitle}>{unread ? `${unread} unread` : 'You’re all caught up'}</Text>
      </View>

      {pushStatus !== 'granted' && pushStatus !== 'unsupported' ? (
        <View style={styles.pushCard}>
          <Ionicons name="notifications-outline" size={20} color={authColors.coral} />
          <Text style={styles.pushText}>
            {pushStatus === 'denied'
              ? 'Notifications are turned off in your device settings.'
              : 'Turn on push notifications for booking updates and reminders.'}
          </Text>
          {pushStatus !== 'denied' ? (
            <Pressable accessibilityRole="button" disabled={enabling} onPress={() => void turnOn()} style={({ pressed }) => [styles.turnOnBtn, pressed && styles.pressed]}>
              <Text style={styles.turnOnText}>{enabling ? 'Please wait…' : 'Turn on'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!loaded ? <LoadingState label="Loading notifications…" />
        : error ? <ErrorState message={error} onRetry={() => void load()} />
        : !items.length ? <EmptyState icon="notifications-outline" title="Nothing yet" message="Booking updates, reminders and messages will show up here." />
        : (
          <View style={styles.list}>
            {unread ? <Pressable accessibilityRole="button" onPress={() => void markAll()} style={styles.markAll}><Text style={styles.markAllText}>Mark all as read</Text></Pressable> : null}
            {items.map((notification) => (
              <Pressable
                key={notification.id}
                accessibilityRole="button"
                accessibilityLabel={`${notification.title}. ${notification.readAt ? 'Read.' : 'Unread.'}`}
                onPress={() => openNotification(notification)}
                style={[styles.item, !notification.readAt && styles.itemUnread]}
              >
                <View style={styles.itemIcon}><Ionicons name={categoryIcon(notification.category)} size={18} color={authColors.coral} /></View>
                <View style={styles.itemCopy}>
                  <Text style={styles.itemTitle}>{notification.title}</Text>
                  <Text style={styles.itemBody}>{notification.body}</Text>
                  <Text style={styles.itemMeta}>{formatDateTime(notification.createdAt)}</Text>
                </View>
                {!notification.readAt ? <View style={styles.unreadDot} /> : null}
              </Pressable>
            ))}
          </View>
        )}
    </Screen>
  );
}

function categoryIcon(category: CustomerNotificationCategory): keyof typeof Ionicons.glyphMap {
  switch (category) {
    case 'booking_update':
    case 'appointment_reminder': return 'calendar-outline';
    case 'message': return 'chatbubble-outline';
    case 'ai_reply': return 'sparkles';
    case 'promotion': return 'pricetag-outline';
    case 'review_reminder': return 'star-outline';
    case 'loyalty': return 'gift-outline';
    case 'legal_update': return 'document-text-outline';
    default: return 'notifications-outline';
  }
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  pushCard: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, padding: authSpace.md, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, marginBottom: authSpace.sm, ...authShadow.card },
  pushText: { flex: 1, ...authType.body, fontSize: 12, color: authColors.ink },
  turnOnBtn: { paddingHorizontal: authSpace.sm, paddingVertical: 8, borderRadius: authRadius.pill, backgroundColor: authColors.coralSoft },
  turnOnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: authColors.coral },
  pressed: { opacity: 0.75 },
  list: { gap: authSpace.xs },
  markAll: { alignSelf: 'flex-end', paddingVertical: authSpace.xs },
  markAllText: { ...authType.link },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: authSpace.sm, padding: authSpace.md, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, ...authShadow.card },
  itemUnread: { borderColor: authColors.coral },
  itemIcon: { width: 34, height: 34, borderRadius: authRadius.pill, backgroundColor: authColors.coralSoft, alignItems: 'center', justifyContent: 'center' },
  itemCopy: { flex: 1, minWidth: 0, gap: 2 },
  itemTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  itemBody: { ...authType.body, fontSize: 12 },
  itemMeta: { ...authType.micro, textTransform: 'none', letterSpacing: 0, fontSize: 11, marginTop: authSpace.xxs },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: authColors.coral, marginTop: 6 },
});
