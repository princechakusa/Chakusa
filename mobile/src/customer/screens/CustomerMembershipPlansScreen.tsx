import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, LoadingState, PrimaryButton, Screen } from '../../components/ui';
import type { MembershipPlanDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { membershipPlanPriceCaption } from '../domain/customerLoyalty';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerMembershipPlans'>;

// PROGRAM 2 LOOP 8: membership plans for a business + enrolment.
//
// CRITICAL: Loop 5 records the membership entitlement WITHOUT taking
// payment. There is no Stripe / IAP / Play Billing / card form / checkout.
// The price is shown for transparency, always paired with the fact that
// Chakusa is not collecting it here.

export function CustomerMembershipPlansScreen({ route, navigation }: Props) {
  const { slug, businessName } = route.params;
  const [plans, setPlans] = useState<MembershipPlanDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setPlans(await loyaltyApi.membershipPlans(slug)); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load membership plans.'); }
    finally { setLoaded(true); }
  }, [slug]);

  useEffect(() => { void load(); }, [load]);

  const enrol = (plan: MembershipPlanDto) => {
    Alert.alert(
      `Join ${plan.name}?`,
      `You’ll get this plan’s member benefits right away. ${membershipPlanPriceCaption(plan)}.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Join',
          onPress: async () => {
            setEnrollingId(plan.id);
            try {
              await loyaltyApi.enrolMembership(slug, plan.id);
              navigation.navigate('CustomerMemberships');
            } catch (caught) {
              Alert.alert('Could not join', caught instanceof ApiError ? caught.message : 'Please try again.');
            } finally {
              setEnrollingId(null);
            }
          },
        },
      ],
    );
  };

  if (!loaded) return <Screen><LoadingState label="Loading plans…" /></Screen>;
  if (error) return <Screen><ErrorState message={error} onRetry={load} /></Screen>;

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow="MEMBERSHIP" title={businessName ? `${businessName} membership` : 'Membership plans'} />
      <Text style={styles.disclaimer}>Chakusa does not collect membership payment in the app. Joining records your membership and its benefits; the business arranges any payment with you directly.</Text>

      {!plans.length ? (
        <EmptyState icon="star-outline" title="No plans available" message="This business isn’t offering membership plans right now." />
      ) : (
        <View style={styles.list}>
          {plans.map((plan) => (
            <View key={plan.id} style={styles.card}>
              <Text style={styles.name}>{plan.name}</Text>
              {plan.description ? <Text style={styles.meta}>{plan.description}</Text> : null}
              <Text style={styles.price}>{membershipPlanPriceCaption(plan)}</Text>
              <View style={styles.perks}>
                {plan.discountPercent > 0 ? <Text style={styles.perk}>• {plan.discountPercent}% off services</Text> : null}
                {plan.priorityBooking ? <Text style={styles.perk}>• Priority booking</Text> : null}
                {(plan.perks ?? []).map((perk, index) => <Text key={index} style={styles.perk}>• {perk}</Text>)}
              </View>
              <PrimaryButton fullWidth label={enrollingId === plan.id ? 'Joining…' : 'Join this plan'} disabled={enrollingId != null} onPress={() => enrol(plan)} />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  disclaimer: { ...typography.caption, color: colors.textSecondary },
  list: { gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs },
  name: { ...typography.subheading, color: colors.text },
  meta: { ...typography.caption, color: colors.textSecondary },
  price: { ...typography.bodyStrong, color: colors.text },
  perks: { gap: spacing.xxs },
  perk: { ...typography.caption, color: colors.textSecondary },
});
