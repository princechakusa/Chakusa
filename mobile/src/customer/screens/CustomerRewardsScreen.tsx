import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, LoadingState, PrimaryButton, Screen, SectionHeader } from '../../components/ui';
import type { WalletDto } from '../../apiTypes';
import { transactionLabel } from '../../domain/loyalty';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDate } from '../../utils/format';
import { LoyaltyBusinessCard, PointsSummary } from '../components/loyalty';
import { rewardsHubSections, walletIsEmpty } from '../domain/customerLoyalty';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;
type IconName = keyof typeof Ionicons.glyphMap;

// PROGRAM 2 LOOP 8: the customer loyalty hub. `/customer/loyalty/wallet`
// aggregates points, tiers, rewards, memberships and referrals across every
// business. Points shown here stay business-specific — the copy makes that
// explicit; they are never one spendable balance.

export function CustomerRewardsScreen() {
  const navigation = useNavigation<Nav>();
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try { setWallet(await loyaltyApi.wallet()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load your rewards.'); }
    finally { setLoaded(true); }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow="MY REWARDS" title="Rewards" subtitle="Points, tiers, rewards and memberships across Chakusa." />

      {!loaded ? <LoadingState label="Loading your rewards…" />
        : error ? <ErrorState message={error} onRetry={() => void load()} />
        : !wallet ? null
        : walletIsEmpty(wallet) ? (
          <View style={styles.firstUse}>
            <EmptyState
              icon="gift-outline"
              title="No rewards yet"
              message="Many businesses on Chakusa reward you for booking. Join a business’s reward program from its profile to start earning points."
            />
            <PrimaryButton fullWidth icon="compass-outline" label="Explore businesses" onPress={() => navigation.navigate('CustomerTabs', { screen: 'CustomerExplore' })} />
          </View>
        ) : (
          <HubBody wallet={wallet} navigation={navigation} />
        )}
    </Screen>
  );
}

function HubBody({ wallet, navigation }: { wallet: WalletDto; navigation: Nav }) {
  const sections = rewardsHubSections(wallet);
  return (
    <>
      <PointsSummary total={sections.points.total} caption={sections.points.caption} />

      <View style={styles.quickRow}>
        <QuickTile icon="ticket-outline" label="Rewards ready" value={sections.rewardsReady} onPress={() => navigation.navigate('CustomerRedemptions')} />
        <QuickTile icon="star-outline" label="Memberships" value={sections.activeMemberships} onPress={() => navigation.navigate('CustomerMemberships')} />
        <QuickTile icon="people-outline" label="Referrals" value={sections.referralsCompleted} onPress={() => navigation.navigate('CustomerReferrals')} />
      </View>

      {sections.businesses.length ? (
        <>
          <SectionHeader title="Where you earn rewards" />
          <View style={styles.list}>
            {sections.businesses.map((business) => (
              <LoyaltyBusinessCard
                key={business.businessId}
                business={business}
                onPress={() => navigation.navigate('CustomerLoyaltyBusiness', { businessId: business.businessId, slug: business.slug ?? undefined, businessName: business.name })}
              />
            ))}
          </View>
        </>
      ) : null}

      {sections.hasActivity ? (
        <>
          <SectionHeader title="Recent points activity" />
          <View style={styles.activity}>
            {wallet.recentTransactions.slice(0, 6).map((txn) => (
              <View key={txn.id} style={styles.activityRow}>
                <View style={styles.activityCopy}>
                  <Text style={styles.activityLabel}>{transactionLabel(txn)}</Text>
                  <Text style={styles.activityMeta}>{txn.business?.name ?? ''} · {formatDate(txn.createdAt)}</Text>
                </View>
                <Text style={[styles.delta, txn.points < 0 && styles.deltaNegative]}>
                  {txn.points >= 0 ? '+' : ''}{txn.points.toLocaleString('en-US')}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <Text style={styles.footnote}>Points are a loyalty reward from each business and can only be used with that business. They are not money and cannot be transferred or cashed out.</Text>
    </>
  );
}

function QuickTile({ icon, label, value, onPress }: { icon: IconName; label: string; value: number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} onPress={onPress} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={colors.primary} />
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  firstUse: { gap: spacing.md },
  quickRow: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center', gap: spacing.xxs },
  pressed: { opacity: 0.7 },
  tileValue: { ...typography.heading, color: colors.text },
  tileLabel: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  list: { gap: spacing.xs },
  activity: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  activityCopy: { flex: 1, minWidth: 0 },
  activityLabel: { ...typography.caption, color: colors.text },
  activityMeta: { ...typography.micro, color: colors.tabInactive, marginTop: 2 },
  delta: { ...typography.bodyStrong, color: colors.success },
  deltaNegative: { color: colors.text },
  footnote: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm },
});
