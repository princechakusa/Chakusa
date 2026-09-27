import { useFocusEffect } from '@react-navigation/native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { CustomerMembershipDto } from '../../apiTypes';
import { isMembershipActive, membershipStatusLabel } from '../../domain/loyalty';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { formatDate, formatMoney } from '../../utils/format';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerMemberships'>;

// PROGRAM 2 LOOP 8: the customer's memberships. `/customer/loyalty/
// memberships`. Cancellation offers "at period end" vs "now" only where the
// server supports it (a membership with a current period can do either).
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function SecondaryBtn({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.secondaryBtn, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

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
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>MEMBERSHIPS</Text>
        <Text style={styles.title}>Your memberships</Text>
      </View>

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
                  {formatMoney(membership.plan.priceAmount, membership.plan.currency ?? 'USD')} / {membership.billingInterval === 'annual' ? 'year' : membership.billingInterval === 'unlimited' ? 'one-off' : 'month'} - Chakusa is not collecting this payment
                </Text>
                {membership.currentPeriodEnd ? <Text style={styles.meta}>{membership.cancelAtPeriodEnd ? 'Ends' : 'Renews'} {formatDate(membership.currentPeriodEnd)}</Text> : null}
                {isMembershipActive(membership) && !membership.cancelAtPeriodEnd ? (
                  <SecondaryBtn label={busyId === membership.id ? 'Please wait…' : 'Cancel membership'} disabled={busyId != null} onPress={() => promptCancel(membership)} />
                ) : null}
              </View>
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
  list: { gap: authSpace.sm },
  card: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, padding: authSpace.md, gap: authSpace.xxs, ...authShadow.card },
  name: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: authColors.ink },
  meta: { ...authType.body, fontSize: 12 },
  secondaryBtn: { minHeight: 48, marginTop: authSpace.xs, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
