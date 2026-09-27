import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Reveal, Screen } from '../../components/ui';
import type { CustomerDashboardDto, WalletDto } from '../../apiTypes';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
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
//
// Visual language matches experience/authTheme.ts (warm cream, coral, pill
// shapes), carried over from the auth surfaces per the customer-wide
// restyle to match the Stitch mockups.

function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? <Pressable hitSlop={8} onPress={onAction}><Text style={styles.sectionAction}>{action}</Text></Pressable> : null}
    </View>
  );
}

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
    <Screen style={styles.screen} backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>{greeting.subtitle}</Text>
          <Text style={styles.title}>{greeting.title}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          hitSlop={8}
          onPress={() => navigation.navigate('CustomerNotifications')}
          style={styles.bell}
        >
          <Ionicons name="notifications-outline" size={20} color={authColors.ink} />
          {data && unreadBadge(data.unreadNotifications) ? (
            <View style={styles.badge}><Text style={styles.badgeText}>{unreadBadge(data.unreadNotifications)}</Text></View>
          ) : null}
        </Pressable>
      </View>

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
              <View style={styles.quickIcon}><Ionicons name={action.icon} size={20} color={authColors.coral} /></View>
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
            <View style={styles.loyaltyIcon}><Ionicons name="sparkles" size={18} color={authColors.coral} /></View>
            <View style={styles.cardCopy}>
              <Text style={styles.loyaltyPoints}>{wallet.totalPoints.toLocaleString()} points</Text>
              <Text style={styles.cardMeta}>
                {wallet.accounts.length} business{wallet.accounts.length === 1 ? '' : 'es'} · tap to view rewards
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={authColors.inkFaint} />
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
            <Ionicons name="sparkles" size={20} color={authColors.coral} />
            <Text style={styles.assistantText}>Ask the Chakusa assistant to find or book something</Text>
            <Ionicons name="chevron-forward" size={16} color={authColors.inkFaint} />
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
                {business.favourite ? <Ionicons name="heart" size={16} color={authColors.coral} /> : null}
                <Ionicons name="chevron-forward" size={16} color={authColors.inkFaint} />
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
  if (key === 'CONFIRMED' || key === 'COMPLETED') return { backgroundColor: '#EAF9F1' };
  if (key === 'CANCELLED' || key === 'DECLINED') return { backgroundColor: '#FDECEC' };
  return { backgroundColor: authColors.coralSoft };
}

function statusPillTextStyle(status: string) {
  const key = status.toUpperCase();
  if (key === 'CONFIRMED' || key === 'COMPLETED') return { color: authColors.positive };
  if (key === 'CANCELLED' || key === 'DECLINED') return { color: authColors.danger };
  return { color: authColors.coral };
}

const styles = StyleSheet.create({
  screen: { backgroundColor: authColors.bg },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: authSpace.md },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  bell: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: authRadius.pill, backgroundColor: authColors.surface, borderWidth: 1, borderColor: authColors.line },
  badge: { position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: authColors.coral, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 9, color: authColors.onCoral },

  quickRow: { flexDirection: 'row', gap: authSpace.sm, marginBottom: authSpace.sm },
  quickAction: { flex: 1, alignItems: 'center', gap: authSpace.xxs, paddingVertical: authSpace.sm, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, ...authShadow.card },
  quickIcon: { width: 36, height: 36, borderRadius: authRadius.pill, backgroundColor: authColors.coralSoft, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: authColors.ink },

  loyaltyCard: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, padding: authSpace.md, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.coralSoft, marginBottom: authSpace.sm },
  loyaltyIcon: { width: 36, height: 36, borderRadius: authRadius.pill, backgroundColor: authColors.surface, alignItems: 'center', justifyContent: 'center' },
  loyaltyPoints: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.ink },

  assistant: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, padding: authSpace.md, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, ...authShadow.card },
  assistantText: { flex: 1, ...authType.body, fontSize: 13, color: authColors.ink },
  pressed: { opacity: 0.78 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: authSpace.lg, marginBottom: authSpace.xs },
  sectionTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: authColors.ink },
  sectionAction: { ...authType.link },
  list: { gap: authSpace.xs },
  apptCard: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, padding: authSpace.md, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, ...authShadow.card },
  dateBadge: { width: 44, height: 44, borderRadius: authRadius.md, backgroundColor: authColors.coralSoft, alignItems: 'center', justifyContent: 'center' },
  dateBadgeDay: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: authColors.coral, lineHeight: 20 },
  dateBadgeMonth: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: authColors.coral },
  cardCopy: { flex: 1, minWidth: 0 },
  cardName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  cardMeta: { ...authType.body, fontSize: 12, marginTop: 2 },
  when: { ...authType.body, fontSize: 12, color: authColors.ink, marginTop: 2 },
  statusPill: { paddingHorizontal: authSpace.xs, paddingVertical: 4, borderRadius: authRadius.pill },
  statusPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  bizRow: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, padding: authSpace.sm, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, ...authShadow.card },
  logo: { width: 40, height: 40, borderRadius: authRadius.md, backgroundColor: authColors.coralSoft, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.coral },
  bizName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
});
