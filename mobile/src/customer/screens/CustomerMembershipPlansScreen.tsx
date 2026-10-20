import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { MembershipPlanDto } from '../../apiTypes';
import { authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { membershipPlanPriceCaption } from '../domain/customerLoyalty';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';
import { premium } from '../premiumTheme';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerMembershipPlans'>;

// PROGRAM 2 LOOP 8: membership plans for a business + enrolment.
//
// CRITICAL: Loop 5 records the membership entitlement WITHOUT taking
// payment. There is no Stripe / IAP / Play Billing / card form / checkout.
// The price is shown for transparency, always paired with the fact that
// Chakusa is not collecting it here.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function PrimaryBtn({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryBtn, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

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

  if (!loaded) return <Screen backgroundColor={premium.bg}><LoadingState label="Loading plans…" /></Screen>;
  if (error) return <Screen backgroundColor={premium.bg}><ErrorState message={error} onRetry={load} /></Screen>;

  return (
    <Screen backgroundColor={premium.bg} onRefresh={load}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>MEMBERSHIP</Text>
        <Text style={styles.title}>{businessName ? `${businessName} membership` : 'Membership plans'}</Text>
      </View>
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
              <PrimaryBtn label={enrollingId === plan.id ? 'Joining…' : 'Join this plan'} disabled={enrollingId != null} onPress={() => enrol(plan)} />
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: premium.deep },
  title: { ...authType.title, marginTop: 2 },
  disclaimer: { ...authType.body, fontSize: 12, marginBottom: authSpace.sm },
  list: { gap: authSpace.sm },
  card: { backgroundColor: premium.card, borderRadius: authRadius.lg, borderWidth: 1, borderColor: premium.line, padding: authSpace.md, gap: authSpace.xs, ...authShadow.card },
  name: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: premium.ink },
  meta: { ...authType.body, fontSize: 12 },
  price: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: premium.ink },
  perks: { gap: authSpace.xxs },
  perk: { ...authType.body, fontSize: 12 },
  primaryBtn: { minHeight: 52, borderRadius: authRadius.pill, backgroundColor: premium.deep, alignItems: 'center', justifyContent: 'center', ...authShadow.cta },
  primaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.onDeep },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
