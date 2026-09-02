import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, FilterTabs, LoadingState, Screen } from '../../components/ui';
import type { RewardRedemptionDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDate } from '../../utils/format';
import { redemptionIsUsable, redemptionStatusLabel } from '../domain/customerLoyalty';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;
const TABS = ['active', 'used'] as const;

// PROGRAM 2 LOOP 8: the customer's issued reward redemptions.
// `/customer/loyalty/rewards`. A still-valid "issued" reward opens to a
// full-screen code the customer shows the business. The customer app never
// marks a reward redeemed — that is the business app's job (Loop 6).

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
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow="REWARDS READY" title="Your rewards" subtitle="Codes to show the business when you redeem." />
      <View style={styles.filterWrap}><FilterTabs options={TABS} value={tab} onChange={setTab} /></View>

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
                  {usable ? <Ionicons name="chevron-forward" size={16} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterWrap: { marginHorizontal: -spacing.lg, paddingLeft: spacing.lg },
  list: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  pressed: { opacity: 0.78 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  name: { ...typography.bodyStrong, color: colors.text },
  meta: { ...typography.caption, color: colors.textSecondary },
});
