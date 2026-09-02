import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, FilterTabs, LoadingState, Screen } from '../../components/ui';
import type { CustomerBookingDto } from '../../apiTypes';
import { partitionBookings } from '../../domain/booking';
import { ApiError } from '../../services/api';
import { colors, spacing, typography } from '../../theme';
import { BookingCard } from '../components/cards';
import { bookingApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;
const TABS = ['upcoming', 'past'] as const;

// PROGRAM 2 LOOP 7: My Bookings. `/customer/bookings` for the list,
// split into upcoming/past by `domain/booking.ts`. Management
// (reschedule/cancel) lives on the detail screen.

export function CustomerBookingsScreen() {
  const navigation = useNavigation<Nav>();
  const [tab, setTab] = useState<(typeof TABS)[number]>('upcoming');
  const [bookings, setBookings] = useState<CustomerBookingDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try { setBookings(await bookingApi.list('all')); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load your bookings.'); }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const { upcoming, past } = partitionBookings(bookings);
  const shown = tab === 'upcoming' ? upcoming : past;

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow="MY BOOKINGS" title="Bookings" subtitle="Everything you’ve booked through Chakusa." />
      <View style={styles.filterWrap}><FilterTabs options={TABS} value={tab} onChange={setTab} /></View>

      {!loaded ? <LoadingState label="Loading your bookings…" />
        : error ? <ErrorState message={error} onRetry={() => void load()} />
        : !shown.length ? (
          <EmptyState
            icon="calendar-outline"
            title={tab === 'upcoming' ? 'No upcoming bookings' : 'No past bookings'}
            message={tab === 'upcoming' ? 'When you book an appointment it will appear here.' : 'Your appointment history will build up here.'}
          />
        ) : (
          <View style={styles.list}>
            <Text style={styles.count}>{shown.length} booking{shown.length === 1 ? '' : 's'}</Text>
            {shown.map((booking) => (
              <BookingCard key={booking.id} booking={booking} onPress={() => navigation.navigate('BookingDetail', { bookingId: booking.id })} />
            ))}
          </View>
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterWrap: { marginHorizontal: -spacing.lg, paddingLeft: spacing.lg },
  list: { gap: spacing.sm },
  count: { ...typography.caption, color: colors.textSecondary },
});
