import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ErrorState, LoadingState, Reveal, Screen } from '../../components/ui';
import type { CustomerDashboardDto, WalletDto } from '../../apiTypes';
import { ProfilePhoto } from '../../components/ProfilePhoto';
import { premium, premiumSerif, premiumShadow } from '../premiumTheme';
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
    <Screen style={styles.screen} backgroundColor={premium.bg} onRefresh={load}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>{greeting.subtitle.toUpperCase()}</Text>
          <Text style={styles.title}>{greeting.title}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          hitSlop={8}
          onPress={() => navigation.navigate('CustomerNotifications')}
          style={styles.bell}
        >
          <Ionicons name="notifications-outline" size={20} color={premium.ink} />
          {data && unreadBadge(data.unreadNotifications) ? (
            <View style={styles.badge}><Text style={styles.badgeText}>{unreadBadge(data.unreadNotifications)}</Text></View>
          ) : null}
        </Pressable>
      </View>

      <Reveal>
        <Pressable accessibilityRole="search" accessibilityLabel="Find a place near you" onPress={() => navigation.navigate('CustomerTabs', { screen: 'CustomerExplore' })} style={({ pressed }) => [styles.hero, premiumShadow, pressed && styles.pressed]}>
          <Text style={styles.heroTitle}>Find something{'\n'}good nearby.</Text>
          <Text style={styles.heroBody}>Salons, barbers, spas and more, on the map around you.</Text>
          <View style={styles.heroSearch}>
            <Ionicons name="search" size={17} color={premium.inkSoft} />
            <Text style={styles.heroSearchText}>Search or open the map</Text>
            <View style={styles.heroGo}><Ionicons name="map-outline" size={16} color={premium.onDeep} /></View>
          </View>
        </Pressable>
      </Reveal>

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
              <View style={styles.quickIcon}><Ionicons name={action.icon} size={20} color={premium.deep} /></View>
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
            <View style={styles.loyaltyIcon}><Ionicons name="sparkles" size={18} color={premium.gold} /></View>
            <View style={styles.cardCopy}>
              <Text style={styles.loyaltyPoints}>{wallet.totalPoints.toLocaleString()} points</Text>
              <Text style={styles.cardMeta}>
                {wallet.accounts.length} business{wallet.accounts.length === 1 ? '' : 'es'} · tap to view rewards
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={premium.onDeepSoft} />
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
      <Reveal>
        <View style={styles.emptyCard}>
          <View style={styles.emptyIcon}><Ionicons name="calendar-outline" size={24} color={premium.deep} /></View>
          <Text style={styles.emptyTitle}>Your plans will live here</Text>
          <Text style={styles.emptyBody}>Book a place you like in Explore and your upcoming visits show up right here.</Text>
          <Pressable accessibilityRole="button" onPress={() => navigation.navigate('CustomerTabs', { screen: 'CustomerExplore' })} style={({ pressed }) => [styles.emptyCta, pressed && styles.pressed]}>
            <Text style={styles.emptyCtaText}>Explore places</Text>
            <Ionicons name="arrow-forward" size={16} color={premium.onDeep} />
          </Pressable>
        </View>
      </Reveal>
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
            <View style={styles.assistantIcon}><Ionicons name="sparkles" size={18} color={premium.gold} /></View>
            <View style={styles.cardCopy}>
              <Text style={styles.assistantTitle}>Chakusa assistant</Text>
              <Text style={styles.assistantText}>Ask it to find or book something for you</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={premium.onDeepSoft} />
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
                    <Text style={styles.bizMeta}>{appointment.businessName}</Text>
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
                <ProfilePhoto name={business.name} size={44} />
                <View style={styles.cardCopy}>
                  <Text style={styles.bizName} numberOfLines={1}>{business.name}</Text>
                  {business.industry ? <Text style={styles.bizMeta} numberOfLines={1}>{business.industry}</Text> : null}
                </View>
                {business.favourite ? <Ionicons name="heart" size={16} color={premium.danger} /> : null}
                <Ionicons name="chevron-forward" size={16} color={premium.inkFaint} />
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
  return { backgroundColor: premium.sage };
}

function statusPillTextStyle(status: string) {
  const key = status.toUpperCase();
  if (key === 'CONFIRMED' || key === 'COMPLETED') return { color: '#1E7A55' };
  if (key === 'CANCELLED' || key === 'DECLINED') return { color: premium.danger };
  return { color: premium.deep };
}

const card = { borderRadius: 20, borderWidth: 1, borderColor: premium.line, backgroundColor: premium.card } as const;

const styles = StyleSheet.create({
  screen: { backgroundColor: premium.bg },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1, color: premium.inkFaint },
  title: { fontFamily: premiumSerif, fontSize: 30, lineHeight: 36, color: premium.ink, marginTop: 4 },
  bell: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: premium.card, borderWidth: 1, borderColor: premium.line },
  badge: { position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: premium.gold, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 9, color: '#FFFFFF' },

  hero: { backgroundColor: premium.deep, borderRadius: 26, padding: 22, marginBottom: 14 },
  heroTitle: { fontFamily: premiumSerif, fontSize: 28, lineHeight: 33, color: premium.onDeep },
  heroBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: premium.onDeepSoft, marginTop: 8 },
  heroSearch: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, backgroundColor: premium.card, borderRadius: 999, paddingLeft: 16, paddingRight: 6, height: 50 },
  heroSearchText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, color: premium.inkSoft },
  heroGo: { width: 38, height: 38, borderRadius: 19, backgroundColor: premium.deep, alignItems: 'center', justifyContent: 'center' },

  quickRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  quickAction: { ...card, flex: 1, alignItems: 'center', gap: 8, paddingVertical: 16 },
  quickIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: premium.sageSoft, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: premium.ink },

  loyaltyCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 20, backgroundColor: premium.deepSoft, marginBottom: 12 },
  loyaltyIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(246,244,233,0.12)', alignItems: 'center', justifyContent: 'center' },
  loyaltyPoints: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.onDeep },

  assistant: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 20, backgroundColor: premium.deep },
  assistantIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(246,244,233,0.12)', alignItems: 'center', justifyContent: 'center' },
  assistantTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.onDeep },
  assistantText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: premium.onDeepSoft, marginTop: 2 },
  pressed: { opacity: 0.8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  sectionTitle: { fontFamily: premiumSerif, fontSize: 21, color: premium.ink },
  sectionAction: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: premium.deep },
  list: { gap: 10 },
  apptCard: { ...card, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  dateBadge: { width: 50, height: 54, borderRadius: 14, backgroundColor: premium.deep, alignItems: 'center', justifyContent: 'center' },
  dateBadgeDay: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 18, color: premium.onDeep, lineHeight: 22 },
  dateBadgeMonth: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.6, color: premium.onDeepSoft },
  cardCopy: { flex: 1, minWidth: 0 },
  cardName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.ink },
  cardMeta: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: premium.onDeepSoft, marginTop: 2 },
  when: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: premium.ink, marginTop: 3 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999 },
  statusPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  bizRow: { ...card, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  bizName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.ink },
  bizMeta: { fontFamily: 'Inter_400Regular', fontSize: 12.5, color: premium.inkSoft, marginTop: 2 },

  emptyCard: { ...card, alignItems: 'center', padding: 24, marginTop: 6 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: premium.sage, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontFamily: premiumSerif, fontSize: 21, color: premium.ink, textAlign: 'center' },
  emptyBody: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20, color: premium.inkSoft, textAlign: 'center', marginTop: 6 },
  emptyCta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, backgroundColor: premium.deep, borderRadius: 999, paddingHorizontal: 20, height: 46 },
  emptyCtaText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: premium.onDeep },
});
