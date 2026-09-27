import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { RewardRedemptionDto } from '../../apiTypes';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { formatDate } from '../../utils/format';
import { redemptionIsUsable, redemptionStatusLabel } from '../domain/customerLoyalty';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;
const TABS = ['active', 'used'] as const;

// PROGRAM 2 LOOP 8: the customer's issued reward redemptions.
// `/customer/loyalty/rewards`. A still-valid "issued" reward opens to a
// full-screen code the customer shows the business. The customer app never
// marks a reward redeemed - that is the business app's job (Loop 6).
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

export function CustomerRedemptionsScreen() {
  const navigation = useNavigation<Nav>();
  const [tab, setTab] = useState<(typeof TABS)[number]>('active');
  const [items, setItems] = useState<RewardRedemptionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await loyaltyApi.myRedemptions()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load your rewards.'); }
    finally { setLoaded(true); }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const shown = items.filter((r) => (tab === 'active' ? redemptionIsUsable(r) : !redemptionIsUsable(r)));

  return (
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>REWARDS READY</Text>
        <Text style={styles.title}>Your rewards</Text>
        <Text style={styles.subtitle}>Codes to show the business when you redeem.</Text>
      </View>

      <View style={styles.segment}>
        {TABS.map((option) => (
          <Pressable key={option} onPress={() => setTab(option)} style={[styles.segmentItem, tab === option && styles.segmentItemActive]}>
            <Text style={[styles.segmentText, tab === option && styles.segmentTextActive]}>{option === 'active' ? 'Active' : 'Used'}</Text>
          </Pressable>
        ))}
      </View>

      {!loaded ? <LoadingState label="Loading your rewards…" />
        : error ? <ErrorState message={error} onRetry={() => void load()} />
        : !shown.length ? (
          <EmptyState
            icon="ticket-outline"
            title={tab === 'active' ? 'No rewards to use' : 'Nothing here yet'}
            message={tab === 'active' ? 'When you redeem a reward, its code appears here to show the business.' : 'Used and expired rewards will be listed here.'}
          />
        ) : (
          <View style={styles.list}>
            {shown.map((redemption) => {
              const usable = redemptionIsUsable(redemption);
              return (
                <Pressable
                  key={redemption.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${redemption.reward?.name ?? 'Reward'} at ${redemption.business?.name ?? 'a business'}. ${redemptionStatusLabel(redemption.status)}.`}
                  disabled={!usable}
                  onPress={() => navigation.navigate('CustomerRedemptionDetail', { redemption })}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <View style={styles.copy}>
                    <Text style={styles.name}>{redemption.reward?.name ?? 'Reward'}</Text>
                    <Text style={styles.meta}>{redemption.business?.name ?? ''} · {redemptionStatusLabel(redemption.status)}</Text>
                    {redemption.expiresAt ? <Text style={styles.meta}>Expires {formatDate(redemption.expiresAt)}</Text> : null}
                  </View>
                  {usable ? <Ionicons name="chevron-forward" size={16} color={authColors.coral} /> : null}
                </Pressable>
              );
            })}
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
  list: { gap: authSpace.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, padding: authSpace.md, backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, ...authShadow.card },
  pressed: { opacity: 0.78 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  meta: { ...authType.body, fontSize: 12 },
});
