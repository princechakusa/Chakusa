import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import type { CalendarSubscriptionDto } from '../apiTypes';
import { calendarApi } from '../services/endpoints';
import { m3, m3Radius, m3Shadow, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { RootStackParamList } from '../types';
import { formatDateTime } from '../utils/format';

export function ExternalCalendarScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [items, setItems] = useState<CalendarSubscriptionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await calendarApi.listSubscriptions());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load calendar subscriptions.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await calendarApi.createSubscription();
      await Share.share({
        title: 'Chakusa calendar subscription',
        message: `Add this read-only calendar URL to Apple Calendar, Google Calendar, or Outlook:\n\n${created.feedUrl}\n\nKeep it private. Revoke it in Chakusa if it is shared accidentally.`,
      });
      await load();
    } catch (e) {
      Alert.alert('Could not create calendar link', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  };
  const revoke = (item: CalendarSubscriptionDto) =>
    Alert.alert('Revoke this calendar link?', 'Calendar apps will stop receiving updates from this link. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await calendarApi.revokeSubscription(item.id);
            await load();
          } catch (e) {
            Alert.alert('Could not revoke link', e instanceof Error ? e.message : 'Please try again.');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);

  const header = <M3Header businessName="External calendar" onBack={() => navigation.goBack()} />;
  const activeCount = items.filter((item) => !item.revokedAt).length;

  if (loading) {
    return (
      <M3Screen header={header}>
        <M3Loading label="Loading calendar settings…" />
      </M3Screen>
    );
  }
  if (error) {
    return (
      <M3Screen header={header}>
        <M3Error message={error} onRetry={() => void load()} />
      </M3Screen>
    );
  }

  return (
    <M3Screen header={header}>
      <View style={styles.titleWrap}>
        <Text style={styles.title}>External Calendar Sync</Text>
        <Text style={styles.subtitle}>Keep a read-only Chakusa calendar in Apple, Google, or Outlook.</Text>
      </View>

      <View style={styles.notice}>
        <View style={styles.noticeTop}>
          <View style={styles.noticeIcon}>
            <Icon name="shield" size={20} color={m3.onSecondaryContainer} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.noticeTitle}>Private subscription links</Text>
            <Text style={styles.noticeText}>
              Links include business name, service names, times, and cancellation state only. Treat each link like a password and revoke it if
              exposed.
            </Text>
          </View>
        </View>
        {items.length ? (
          <View style={styles.noticeStats}>
            <Chip label={`${activeCount} active link${activeCount === 1 ? '' : 's'}`} tone="secondary" icon="link" />
            <Chip label={`${items.length - activeCount} revoked`} tone="neutral" icon="link_off" />
          </View>
        ) : null}
      </View>

      <PrimaryButton fullWidth disabled={busy} label={busy ? 'Working…' : 'Create calendar link'} icon="add-outline" onPress={() => void create()} />

      {items.length === 0 ? (
        <M3Empty icon="event" title="No calendar links" message="Create one to subscribe from your calendar app." />
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <M3Card key={item.id} style={styles.card}>
              <View style={styles.cardTop}>
                <View style={styles.cardIcon}>
                  <Icon name={item.revokedAt ? 'link_off' : 'calendar_month'} size={20} color={item.revokedAt ? m3.onSurfaceVariant : m3.primary} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.cardLabel}>{item.label}</Text>
                  <Text style={styles.cardMeta}>Created {formatDateTime(item.createdAt)}</Text>
                  {item.lastAccessedAt ? <Text style={styles.cardMeta}>Last refreshed {formatDateTime(item.lastAccessedAt)}</Text> : null}
                </View>
                <Chip label={item.revokedAt ? 'Revoked' : 'Active'} tone={item.revokedAt ? 'error' : 'secondary'} />
              </View>
              {!item.revokedAt ? (
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => revoke(item)} style={styles.revokeBtn}>
                  <Icon name="close" size={15} color={m3.error} />
                  <Text style={styles.revokeText}>Revoke link</Text>
                </Pressable>
              ) : null}
            </M3Card>
          ))}
        </View>
      )}
    </M3Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  list: { gap: m3Space.sm },

  titleWrap: { gap: 2 },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant },

  notice: { backgroundColor: m3.surfaceContainerHigh, borderRadius: m3Radius.lg, padding: m3Space.md, gap: m3Space.sm },
  noticeTop: { flexDirection: 'row', gap: m3Space.sm },
  noticeIcon: { width: 40, height: 40, borderRadius: m3Radius.md, backgroundColor: m3.secondaryContainer, alignItems: 'center', justifyContent: 'center' },
  noticeTitle: { ...m3Type.titleMd, color: m3.onSurface },
  noticeText: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2, lineHeight: 19 },
  noticeStats: { flexDirection: 'row', gap: m3Space.xs, flexWrap: 'wrap' },

  card: { gap: m3Space.sm },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: m3Space.sm },
  cardIcon: { width: 42, height: 42, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { ...m3Type.titleMd, color: m3.onSurface },
  cardMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  revokeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 38, borderRadius: m3Radius.sm, backgroundColor: m3.errorContainer },
  revokeText: { ...m3Type.labelMd, color: m3.error },
});
