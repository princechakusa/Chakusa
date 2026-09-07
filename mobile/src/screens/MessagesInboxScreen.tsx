import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ConversationSummaryDto, messagingApi } from '../services/endpoints';
import { useAppState } from '../state/AppContext';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const filters = ['all', 'unread', 'assigned', 'unassigned', 'closed'] as const;
type Filter = (typeof filters)[number];
const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  unread: 'Unread',
  assigned: 'Assigned',
  unassigned: 'Unassigned',
  closed: 'Closed',
};

const CHANNEL_ICON: Record<string, string> = { sms: 'sms', whatsapp: 'forum', email: 'mail', call: 'call' };

function relative(iso?: string) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  if (mins < 1440) return `${Math.round(mins / 60)}h`;
  return `${Math.round(mins / 1440)}d`;
}
function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}
const isUnread = (c: ConversationSummaryDto) => c.status === 'OPEN' || c.priority === 'HIGH' || c.priority === 'URGENT';
const isClosed = (c: ConversationSummaryDto) => c.status === 'RESOLVED' || c.status === 'ARCHIVED';

export function MessagesInboxScreen() {
  const navigation = useNavigation<Nav>();
  const { customers, state, loadCustomers } = useAppState();
  const [items, setItems] = useState<ConversationSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async (soft = false) => {
    soft ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      setItems(await messagingApi.conversations());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load conversations.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => {
    if (!state.customers.loaded) void loadCustomers();
  }, [loadCustomers, state.customers.loaded]);

  const nameFor = useCallback(
    (c: ConversationSummaryDto) => {
      const cid = c.messages[0]?.customerId;
      const found = cid ? customers.find((x) => x.id === cid) : null;
      return found?.name ?? 'Conversation';
    },
    [customers],
  );

  const unreadCount = useMemo(() => items.filter(isUnread).length, [items]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((c) => {
      if (filter === 'unread' && !isUnread(c)) return false;
      if (filter === 'assigned' && !c.assignedMemberId) return false;
      if (filter === 'unassigned' && c.assignedMemberId) return false;
      if (filter === 'closed' && !isClosed(c)) return false;
      if (filter !== 'closed' && isClosed(c) && filter !== 'all') return false;
      if (!q) return true;
      return `${nameFor(c)} ${c.messages[0]?.body ?? ''}`.toLowerCase().includes(q);
    });
  }, [items, filter, search, nameFor]);

  const header = (
    <M3Header
      businessName="Messages"
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      onAvatarPress={() => navigation.navigate('AccountInformation')}
      hasNotifications={unreadCount > 0}
    />
  );

  return (
    <M3Screen
      header={header}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={m3.primary} />}
    >
      <View style={styles.titleRow}>
        <Text style={styles.title}>Messages</Text>
        {unreadCount ? <Chip label={`${unreadCount} unread`} tone="primary" /> : null}
      </View>

      <View style={styles.searchRow}>
        <Icon name="search" size={18} color={m3.outline} style={styles.searchIcon} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search conversations, clients…"
          placeholderTextColor={m3.outline}
          style={styles.searchInput}
        />
      </View>

      <View style={styles.chipsWrap}>
        {filters.map((f) => (
          <Chip
            key={f}
            label={FILTER_LABEL[f]}
            selected={filter === f}
            count={f === 'all' ? items.length : f === 'unread' ? unreadCount : undefined}
            onPress={() => setFilter(f)}
          />
        ))}
      </View>

      {loading && !items.length ? (
        <M3Loading label="Loading conversations…" />
      ) : error ? (
        <M3Error message={error} onRetry={() => void load()} />
      ) : visible.length ? (
        <View style={styles.list}>
          {visible.map((c) => {
            const last = c.messages[0];
            const name = nameFor(c);
            const unread = isUnread(c);
            const inbound = (last?.direction ?? '').toLowerCase().startsWith('in');
            return (
              <M3Card
                key={c.id}
                onPress={() => navigation.navigate('MessageThread', { conversationId: c.id })}
                style={styles.convCard}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(name)}</Text>
                </View>
                <View style={styles.flex}>
                  <View style={styles.convTopRow}>
                    <Text numberOfLines={1} style={[styles.convName, unread && styles.convNameUnread]}>
                      {name}
                    </Text>
                    <Text style={styles.convTime}>{relative(last?.createdAt ?? c.updatedAt)}</Text>
                  </View>
                  <Text numberOfLines={2} style={[styles.convPreview, unread && styles.convPreviewUnread]}>
                    {inbound ? '' : 'You: '}
                    {last?.body ?? 'No messages yet'}
                  </Text>
                  <View style={styles.convMetaRow}>
                    <View style={styles.channelChip}>
                      <Icon name={CHANNEL_ICON[last?.channel ?? 'sms'] ?? 'chat'} size={12} color={m3.onSecondaryContainer} />
                      <Text style={styles.channelText}>{(last?.channel ?? 'sms').toUpperCase()}</Text>
                    </View>
                    {c.assignedMemberId ? (
                      <Text style={styles.assignedText}>Assigned</Text>
                    ) : (
                      <Text style={styles.unassignedText}>Unassigned</Text>
                    )}
                    {unread ? <View style={styles.unreadDot} /> : null}
                  </View>
                </View>
              </M3Card>
            );
          })}
        </View>
      ) : (
        <M3Empty
          icon="forum"
          title={search || filter !== 'all' ? 'No conversations found' : 'No conversations yet'}
          message={
            search || filter !== 'all'
              ? 'Try a different search or filter.'
              : 'Client messages across SMS and WhatsApp land here.'
          }
        />
      )}
    </M3Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  list: { gap: m3Space.sm },

  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { ...m3Type.headlineMd, color: m3.onSurface },

  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.md, paddingHorizontal: 12, height: 44 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, ...m3Type.bodyMd, color: m3.onSurface, padding: 0 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },

  convCard: { flexDirection: 'row', gap: m3Space.sm },
  avatar: { width: 48, height: 48, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...m3Type.labelLg, color: m3.primary },
  convTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  convName: { ...m3Type.headlineSm, fontSize: 16, color: m3.onSurface, flexShrink: 1 },
  convNameUnread: { fontFamily: m3Type.headlineSm.fontFamily },
  convTime: { ...m3Type.labelSm, color: m3.outline, letterSpacing: 0 },
  convPreview: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
  convPreviewUnread: { color: m3.onSurface, fontFamily: 'Inter_600SemiBold' },
  convMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  channelChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: m3.secondaryContainer, paddingHorizontal: 7, height: 18, borderRadius: m3Radius.full },
  channelText: { ...m3Type.labelXs, fontSize: 9, color: m3.onSecondaryContainer, letterSpacing: 0.3 },
  assignedText: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  unassignedText: { ...m3Type.labelSm, color: m3.primary, letterSpacing: 0 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: m3.primary, marginLeft: 'auto' },
});
