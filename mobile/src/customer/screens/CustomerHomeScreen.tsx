import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, LoadingState, Reveal, Screen, SectionHeader } from '../../components/ui';
import type { CustomerDashboardDto, WalletDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDateTime } from '../../utils/format';
import {
  assistantEntryVisible, homeBusinesses, homeGreeting, homeSectionsState, homeUpcoming, unreadBadge,
} from '../domain/customerHome';
import { customerApi, loyaltyApi } from '../endpoints';
import { useCustomerAuth } from '../CustomerAuthContext';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;

// PROGRAM 2 LOOP 7: Customer Home. Renders exactly the aggregate returned
// by `/customer/dashboard` - greeting, next appointments, saved
// businesses, unread badge, and (only when the backend says so) the AI
// assistant entry point. The loyalty teaser is a best-effort second call to
// `/customer/loyalty/wallet` - never blocks the main dashboard render and
// simply stays hidden if it fails or the customer has no points anywhere.

const QUICK_ACTIONS: Array<{ key: string; label: string; icon: keyof typeof Ionicons.glyphMap; go: (nav: Nav) => void }> = [
  { key: 'explore', label: 'Explore', icon: 'search-outline', go: (nav) => nav.navigate('CustomerTabs', { screen: 'CustomerExplore' }) },
  { key: 'bookings', label: 'Bookings', icon: 'calendar-outline', go: (nav) => nav.navigate('CustomerTabs', { screen: 'CustomerBookings' }) },
  { key: 'rewards', label: 'Rewards', icon: 'gift-outline', go: (nav) => nav.navigate('CustomerRewards') },
];

export function CustomerHomeScreen() {
  const navigation = useNavigation<Nav>();
  const { profile } = useCustomerAuth();
  const [data, setData] = useState<CustomerDashboardDto | null>(null);
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try { setData(await customerApi.dashboard()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load your home screen.'); }
    finally { setLoaded(true); }
    try { setWallet(await loyaltyApi.wallet()); } catch { /* loyalty teaser is optional */ }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const greeting = homeGreeting(profile?.displayName);

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader
        title={greeting.title}
        subtitle={greeting.subtitle}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            hitSlop={8}
            onPress={() => navigation.navigate('CustomerNotifications')}
            style={styles.bell}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            {data && unreadBadge(data.unreadNotifications) ? (
              <View style={styles.badge}><Text style={styles.badgeText}>{unreadBadge(data.unreadNotifications)}</Text></View>
            ) : null}
          </Pressable>
        }
      />

      <Reveal>
        <View style={styles.quickRow}>
          {QUICK_ACTIONS.map((action) => (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              onPress={() => action.go(navigation)}
              style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
            >
              <View style={styles.quickIcon}><Ionicons name={action.icon} size={20} color={colors.primary} /></View>
              <Text style={styles.quickLabel}>{action.label}</Text>
            </Pressable>
          ))}
        </View>
      </Reveal>

      {wallet && wallet.totalPoints > 0 ? (
        <Reveal>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open your rewards"
            onPress={() => navigation.navigate('CustomerRewards')}
            style={({ pressed }) => [styles.loyaltyCard, pressed && styles.pressed]}
          >
            <View style={styles.loyaltyIcon}><Ionicons name="sparkles" size={18} color={colors.primary} /></View>
            <View style={styles.cardCopy}>
              <Text style={styles.loyaltyPoints}>{wallet.totalPoints.toLocaleString()} points</Text>
              <Text style={styles.cardMeta}>
                {wallet.accounts.length} business{wallet.accounts.length === 1 ? '' : 'es'} · tap to view rewards
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.tabInactive} />
          </Pressable>
        </Reveal>
      ) : null}

      {!loaded ? <LoadingState label="Loading your home…" />
        : error && !data ? <ErrorState message={error} onRetry={() => void load()} />
        : data ? <HomeBody data={data} navigation={navigation} /> : null}
    </Screen>
  );
}

function HomeBody({ data, navigation }: { data: CustomerDashboardDto; navigation: Nav }) {
  const upcoming = homeUpcoming(data);
  const businesses = homeBusinesses(data);
  const sections = homeSectionsState(data);

  if (sections.isEmpty) {
    return (
      <EmptyState
        icon="calendar-outline"
        title="Nothing booked yet"
        message="Find a business in Explore to make your first booking. It’ll show up here."
      />
    );
  }

  return (
    <>
      {assistantEntryVisible(data) ? (
        <Reveal>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open the Chakusa assistant"
            onPress={() => navigation.navigate('CustomerAssistant')}
            style={({ pressed }) => [styles.assistant, pressed && styles.pressed]}
          >
            <Ionicons name="sparkles" size={20} color={colors.primary} />
            <Text style={styles.assistantText}>Ask the Chakusa assistant to find or book something</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.tabInactive} />
          </Pressable>
        </Reveal>
      ) : null}

      {upcoming.length ? (
        <Reveal>
          <SectionHeader title="Upcoming" action="All bookings" onAction={() => navigation.navigate('CustomerTabs', { screen: 'CustomerBookings' })} />
          <View style={styles.list}>
            {upcoming.map((appointment) => {
              const when = formatDateTime(appointment.startsAt);
              const startsAt = new Date(appointment.startsAt);
              const day = Number.isNaN(startsAt.getTime()) ? '–' : String(startsAt.getDate());
              const month = Number.isNaN(startsAt.getTime()) ? '' : startsAt.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
              return (
                <View key={appointment.id} style={styles.apptCard}>
                  <View style={styles.dateBadge}>
                    <Text style={styles.dateBadgeDay}>{day}</Text>
                    <Text style={styles.dateBadgeMonth}>{month}</Text>
                  </View>
                  <View style={styles.cardCopy}>
                    <Text style={styles.cardName}>{appointment.serviceName}</Text>
                    <Text style={styles.cardMeta}>{appointment.businessName}</Text>
                    <Text style={styles.when}>{when}</Text>
                  </View>
                  <View style={[styles.statusPill, statusPillStyle(appointment.status)]}>
                    <Text style={[styles.statusPillText, statusPillTextStyle(appointment.status)]}>{formatStatus(appointment.status)}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </Reveal>
      ) : null}

      {businesses.length ? (
        <Reveal>
          <SectionHeader title="Your businesses" action="Explore" onAction={() => navigation.navigate('CustomerTabs', { screen: 'CustomerExplore' })} />
          <View style={styles.list}>
            {businesses.map((business) => (
              <Pressable
                key={business.id}
                accessibilityRole="button"
                accessibilityLabel={`Open ${business.name}`}
                disabled={!business.slug}
                onPress={() => business.slug && navigation.navigate('BusinessProfile', { slug: business.slug })}
                style={({ pressed }) => [styles.bizRow, pressed && styles.pressed]}
              >
                <View style={styles.logo}><Text style={styles.logoText}>{business.name.slice(0, 1).toUpperCase()}</Text></View>
                <View style={styles.cardCopy}>
                  <Text style={styles.bizName} numberOfLines={1}>{business.name}</Text>
                  {business.industry ? <Text style={styles.cardMeta} numberOfLines={1}>{business.industry}</Text> : null}
                </View>
                {business.favourite ? <Ionicons name="heart" size={16} color={colors.primary} /> : null}
                <Ionicons name="chevron-forward" size={16} color={colors.tabInactive} />
              </Pressable>
            ))}
          </View>
        </Reveal>
      ) : null}
    </>
  );
}

function formatStatus(status: string): string {
  const clean = status.replace(/_/g, ' ').toLowerCase();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function statusPillStyle(status: string) {
  const key = status.toUpperCase();
  if (key === 'CONFIRMED' || key === 'COMPLETED') return { backgroundColor: colors.successSoft };
  if (key === 'CANCELLED' || key === 'DECLINED') return { backgroundColor: colors.negativeSoft };
  return { backgroundColor: colors.attentionSoft };
}

function statusPillTextStyle(status: string) {
  const key = status.toUpperCase();
  if (key === 'CONFIRMED' || key === 'COMPLETED') return { color: colors.success };
  if (key === 'CANCELLED' || key === 'DECLINED') return { color: colors.negative };
  return { color: colors.attention };
}

const styles = StyleSheet.create({
  bell: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { ...typography.micro, fontSize: 9, color: colors.surface },

  quickRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  quickAction: { flex: 1, alignItems: 'center', gap: spacing.xxs, paddingVertical: spacing.sm, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  quickIcon: { width: 36, height: 36, borderRadius: radius.round, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { ...typography.caption, color: colors.text },

  loyaltyCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.primarySoft, marginBottom: spacing.sm },
  loyaltyIcon: { width: 36, height: 36, borderRadius: radius.round, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  loyaltyPoints: { ...typography.bodyStrong, color: colors.text },

  assistant: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  assistantText: { flex: 1, ...typography.caption, color: colors.text },
  pressed: { opacity: 0.78 },
  list: { gap: spacing.xs, marginTop: spacing.xs },
  apptCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  dateBadge: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  dateBadgeDay: { ...typography.subheading, color: colors.primary, lineHeight: 20 },
  dateBadgeMonth: { ...typography.micro, color: colors.primary },
  cardCopy: { flex: 1, minWidth: 0 },
  cardName: { ...typography.bodyStrong, color: colors.text },
  cardMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  when: { ...typography.caption, color: colors.text, marginTop: 2 },
  statusPill: { paddingHorizontal: spacing.xs, paddingVertical: 4, borderRadius: radius.round },
  statusPillText: { ...typography.micro },
  bizRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  logo: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  logoText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  bizName: { ...typography.bodyStrong, color: colors.text },
});
