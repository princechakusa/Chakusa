import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { Screen } from '../../components/ui';
import { formatPoints, rewardValueLabel } from '../../domain/loyalty';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { rewardEligibilityReason } from '../domain/customerLoyalty';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerRewardDetail'>;

// PROGRAM 2 LOOP 8: reward detail + redemption. The server validates
// eligibility, deducts points and issues the code - this screen shows
// success only after that confirmation and guards against a double tap.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={authColors.coral} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

function PrimaryBtn({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryBtn, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryBtn({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}>
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

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
    <Screen backgroundColor={authColors.bg}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>REWARD</Text>
        <Text style={styles.title}>{reward.name}</Text>
        {businessName ? <Text style={styles.subtitle}>{businessName}</Text> : null}
      </View>

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

      <PrimaryBtn
        label={redeeming ? 'Redeeming…' : 'Redeem reward'}
        disabled={redeeming || !reward.redeemable}
        onPress={confirm}
      />
      <SecondaryBtn label="Back" onPress={() => navigation.goBack()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  card: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, paddingHorizontal: authSpace.md, ...authShadow.card },
  infoRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: authSpace.sm },
  infoLabel: { ...authType.body, fontSize: 13, flex: 1 },
  infoValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: authColors.ink, textAlign: 'right', maxWidth: '58%' },
  divider: { height: 1, backgroundColor: authColors.lineSoft },
  description: { ...authType.body },
  status: { ...authType.body, fontSize: 13 },
  statusReady: { color: authColors.positive },
  error: { ...authType.body, fontSize: 12, color: authColors.danger },
  primaryBtn: { minHeight: 52, borderRadius: authRadius.pill, backgroundColor: authColors.coral, alignItems: 'center', justifyContent: 'center', ...authShadow.cta },
  primaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.onCoral },
  secondaryBtn: { minHeight: 52, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.ink },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
