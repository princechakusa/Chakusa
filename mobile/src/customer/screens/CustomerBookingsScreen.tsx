import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { CustomerBookingDto } from '../../apiTypes';
import { partitionBookings } from '../../domain/booking';
import { authColors, authRadius, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { BookingCard } from '../components/cards';
import { bookingApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;
const TABS = ['upcoming', 'past'] as const;

// PROGRAM 2 LOOP 7: My Bookings. `/customer/bookings` for the list,
// split into upcoming/past by `domain/booking.ts`. Management
// (reschedule/cancel) lives on the detail screen.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

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
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>MY BOOKINGS</Text>
        <Text style={styles.title}>Bookings</Text>
        <Text style={styles.subtitle}>Everything you’ve booked through Chakusa.</Text>
      </View>

      <View style={styles.segment}>
        {TABS.map((option) => (
          <Pressable key={option} onPress={() => setTab(option)} style={[styles.segmentItem, tab === option && styles.segmentItemActive]}>
            <Text style={[styles.segmentText, tab === option && styles.segmentTextActive]}>{option === 'upcoming' ? 'Upcoming' : 'Past'}</Text>
          </Pressable>
        ))}
      </View>

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
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  segment: { flexDirection: 'row', gap: authSpace.xxs, padding: authSpace.xxs, borderRadius: authRadius.lg, backgroundColor: authColors.bgSunk, marginBottom: authSpace.sm },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: authSpace.sm, borderRadius: authRadius.md },
  segmentItemActive: { backgroundColor: authColors.coral },
  segmentText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: authColors.inkSoft },
  segmentTextActive: { color: authColors.onCoral },
  list: { gap: authSpace.sm },
  count: { ...authType.body, fontSize: 12 },
});
