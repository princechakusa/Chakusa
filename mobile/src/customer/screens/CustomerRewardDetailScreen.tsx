import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { AppHeader, Divider, InfoRow, PrimaryButton, Screen, SecondaryButton } from '../../components/ui';
import { formatPoints, rewardValueLabel } from '../../domain/loyalty';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { rewardEligibilityReason } from '../domain/customerLoyalty';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerRewardDetail'>;

// PROGRAM 2 LOOP 8: reward detail + redemption. The server validates
// eligibility, deducts points and issues the code — this screen shows
// success only after that confirmation and guards against a double tap.

export function CustomerRewardDetailScreen({ route, navigation }: Props) {
  const { businessId, businessName, reward } = route.params;
  const [redeeming, setRedeeming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reason = rewardEligibilityReason(reward);

  const confirm = () => {
    Alert.alert(
      `Redeem “${reward.name}”?`,
      `This uses ${formatPoints(reward.pointsCost)} from your balance with ${businessName ?? 'this business'}.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Redeem', onPress: () => void redeem() },
      ],
    );
  };

  const redeem = async () => {
    if (redeeming) return;
    setRedeeming(true);
    setError(null);
    try {
      const result = await loyaltyApi.redeemReward(businessId, reward.id);
      // Pull the full, server-authoritative redemption record for display.
      const mine = await loyaltyApi.myRedemptions();
      const record = mine.find((r) => r.id === result.id);
      if (record) navigation.replace('CustomerRedemptionDetail', { redemption: record });
      else {
        navigation.goBack();
        Alert.alert('Reward redeemed', `Your code is ${result.code}. Find it under Rewards ready.`);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not redeem this reward.');
      setRedeeming(false);
    }
  };

  return (
    <Screen>
      <AppHeader eyebrow="REWARD" title={reward.name} subtitle={businessName ?? undefined} />

      <View style={styles.card}>
        <InfoRow icon="pricetag-outline" label="Benefit" value={rewardValueLabel(reward)} />
        <Divider />
        <InfoRow icon="star-outline" label="Cost" value={formatPoints(reward.pointsCost)} />
        {reward.minTierKey ? <><Divider /><InfoRow icon="trophy-outline" label="Minimum tier" value={reward.minTierKey} /></> : null}
        {reward.membersOnly ? <><Divider /><InfoRow icon="person-outline" label="Eligibility" value="Members only" /></> : null}
      </View>

      {reward.description ? <Text style={styles.description}>{reward.description}</Text> : null}

      <Text style={[styles.status, reward.redeemable && styles.statusReady]}>{reason}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <PrimaryButton
        fullWidth
        label={redeeming ? 'Redeeming…' : 'Redeem reward'}
        disabled={redeeming || !reward.redeemable}
        onPress={confirm}
      />
      <SecondaryButton fullWidth label="Back" onPress={() => navigation.goBack()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  description: { ...typography.body, color: colors.textSecondary },
  status: { ...typography.caption, color: colors.textSecondary },
  statusReady: { color: colors.success },
  error: { ...typography.caption, color: colors.negative },
});
