import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, LoadingState, Screen, SecondaryButton } from '../../components/ui';
import type { CustomerMembershipDto } from '../../apiTypes';
import { isMembershipActive, membershipStatusLabel } from '../../domain/loyalty';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDate, formatMoney } from '../../utils/format';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerMemberships'>;

// PROGRAM 2 LOOP 8: the customer's memberships. `/customer/loyalty/
// memberships`. Cancellation offers "at period end" vs "now" only where the
// server supports it (a membership with a current period can do either).

export function CustomerMembershipsScreen(_: Props) {
  const [items, setItems] = useState<CustomerMembershipDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setItems(await loyaltyApi.memberships()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load your memberships.'); }
    finally { setLoaded(true); }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const cancel = (membership: CustomerMembershipDto, immediate: boolean) => {
    setBusyId(membership.id);
    loyaltyApi.cancelMembership(membership.id, immediate)
      .then(() => load())
      .catch((caught) => Alert.alert('Could not cancel', caught instanceof ApiError ? caught.message : 'Please try again.'))
      .finally(() => setBusyId(null));
  };

  const promptCancel = (membership: CustomerMembershipDto) => {
    const options: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [{ text: 'Keep membership', style: 'cancel' }];
    if (membership.currentPeriodEnd) {
      options.push({ text: 'Cancel at period end', onPress: () => cancel(membership, false) });
    }
    options.push({ text: 'Cancel now', style: 'destructive', onPress: () => cancel(membership, true) });
    Alert.alert('Cancel membership?', membership.currentPeriodEnd ? `You can keep member benefits until ${formatDate(membership.currentPeriodEnd)} or end it now.` : 'This ends your membership immediately.', options);
  };

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow="MEMBERSHIPS" title="Your memberships" />

      {!loaded ? <LoadingState label="Loading memberships…" />
        : error ? <ErrorState message={error} onRetry={() => void load()} />
        : !items.length ? <EmptyState icon="star-outline" title="No memberships" message="When you join a business’s membership plan it will appear here with its benefits." />
        : (
          <View style={styles.list}>
            {items.map((membership) => (
              <View key={membership.id} style={styles.card}>
                <Text style={styles.name}>{membership.plan.name}</Text>
                <Text style={styles.meta}>{membership.business?.name ?? 'Membership'} · {membershipStatusLabel(membership)}</Text>
                {membership.plan.discountPercent > 0 ? <Text style={styles.meta}>{membership.plan.discountPercent}% off services{membership.plan.priorityBooking ? ' · priority booking' : ''}</Text> : membership.plan.priorityBooking ? <Text style={styles.meta}>Priority booking</Text> : null}
                <Text style={styles.meta}>
                  {formatMoney(membership.plan.priceAmount, membership.plan.currency ?? 'USD')} / {membership.billingInterval === 'annual' ? 'year' : membership.billingInterval === 'unlimited' ? 'one-off' : 'month'} — Chakusa is not collecting this payment
                </Text>
                {membership.currentPeriodEnd ? <Text style={styles.meta}>{membership.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {formatDate(membership.currentPeriodEnd)}</Text> : null}
                {isMembershipActive(membership) && !membership.cancelAtPeriodEnd ? (
                  <SecondaryButton fullWidth label={busyId === membership.id ? 'Please wait…' : 'Cancel membership'} disabled={busyId != null} onPress={() => promptCancel(membership)} />
                ) : null}
              </View>
            ))}
          </View>
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xxs },
  name: { ...typography.subheading, color: colors.text },
  meta: { ...typography.caption, color: colors.textSecondary },
});
