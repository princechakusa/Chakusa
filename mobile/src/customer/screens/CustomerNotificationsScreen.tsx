import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, LoadingState, Screen, SecondaryButton } from '../../components/ui';
import type { CustomerNotificationDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDateTime } from '../../utils/format';
import { customerApi } from '../endpoints';
import { enableCustomerPush, getCustomerPushStatus } from '../push';

// PROGRAM 2 LOOP 7: notifications list + the device-registration entry
// point. Reads `/customer/notifications`; the "Turn on" button asks for OS
// permission and registers the Expo token against `/customer/auth/devices`.

export function CustomerNotificationsScreen() {
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

  const unread = items.filter((n) => !n.readAt).length;

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow="NOTIFICATIONS" title="Updates" subtitle={unread ? `${unread} unread` : 'You’re all caught up'} />

      {pushStatus !== 'granted' && pushStatus !== 'unsupported' ? (
        <View style={styles.pushCard}>
          <Ionicons name="notifications-outline" size={20} color={colors.primary} />
          <Text style={styles.pushText}>
            {pushStatus === 'denied'
              ? 'Notifications are turned off in your device settings.'
              : 'Turn on push notifications for booking updates and reminders.'}
          </Text>
          {pushStatus !== 'denied' ? (
            <SecondaryButton compact label={enabling ? 'Please wait…' : 'Turn on'} disabled={enabling} onPress={() => void turnOn()} />
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
                onPress={() => !notification.readAt && void markRead(notification.id)}
                style={[styles.item, !notification.readAt && styles.itemUnread]}
              >
                <Text style={styles.itemTitle}>{notification.title}</Text>
                <Text style={styles.itemBody}>{notification.body}</Text>
                <Text style={styles.itemMeta}>{formatDateTime(notification.createdAt)}</Text>
              </Pressable>
            ))}
          </View>
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  pushCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  pushText: { flex: 1, ...typography.caption, color: colors.text },
  list: { gap: spacing.xs },
  markAll: { alignSelf: 'flex-end', paddingVertical: spacing.xs },
  markAllText: { ...typography.caption, color: colors.primary },
  item: { padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: spacing.xxs },
  itemUnread: { borderColor: colors.primary },
  itemTitle: { ...typography.bodyStrong, color: colors.text },
  itemBody: { ...typography.caption, color: colors.textSecondary },
  itemMeta: { ...typography.micro, color: colors.tabInactive, marginTop: spacing.xxs },
});
