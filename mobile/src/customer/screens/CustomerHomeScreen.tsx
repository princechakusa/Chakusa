import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, LoadingState, Reveal, Screen, SectionHeader } from '../../components/ui';
import type { CustomerDashboardDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDateTime } from '../../utils/format';
import {
  assistantEntryVisible, homeBusinesses, homeGreeting, homeSectionsState, homeUpcoming, unreadBadge,
} from '../domain/customerHome';
import { customerApi } from '../endpoints';
import { useCustomerAuth } from '../CustomerAuthContext';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;

// PROGRAM 2 LOOP 7: Customer Home. Renders exactly the aggregate returned
// by `/customer/dashboard` — greeting, next appointments, saved
// businesses, unread badge, and (only when the backend says so) the AI
// assistant entry point.

export function CustomerHomeScreen() {
  const navigation = useNavigation<Nav>();
  const { profile } = useCustomerAuth();
  const [data, setData] = useState<CustomerDashboardDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try { setData(await customerApi.dashboard()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load your home screen.'); }
    finally { setLoaded(true); }
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
            {upcoming.map((appointment) => (
              <View key={appointment.id} style={styles.apptCard}>
                <View style={styles.cardCopy}>
                  <Text style={styles.cardName}>{appointment.serviceName}</Text>
                  <Text style={styles.cardMeta}>{appointment.businessName}</Text>
                </View>
                <Text style={styles.when}>{formatDateTime(appointment.startsAt)}</Text>
              </View>
            ))}
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
                <Text style={styles.bizName} numberOfLines={1}>{business.name}</Text>
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

const styles = StyleSheet.create({
  bell: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 4, right: 2, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { ...typography.micro, fontSize: 9, color: colors.surface },
  assistant: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  assistantText: { flex: 1, ...typography.caption, color: colors.text },
  pressed: { opacity: 0.78 },
  list: { gap: spacing.xs, marginTop: spacing.xs },
  apptCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  cardCopy: { flex: 1, minWidth: 0 },
  cardName: { ...typography.bodyStrong, color: colors.text },
  cardMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  when: { ...typography.caption, color: colors.text },
  bizRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  logo: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  logoText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  bizName: { flex: 1, ...typography.bodyStrong, color: colors.text },
});
