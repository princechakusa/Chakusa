import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { WalletDto } from '../../apiTypes';
import { transactionLabel } from '../../domain/loyalty';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { formatDate } from '../../utils/format';
import { LoyaltyBusinessCard, PointsSummary } from '../components/loyalty';
import { rewardsHubSections, walletIsEmpty } from '../domain/customerLoyalty';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;
type IconName = keyof typeof Ionicons.glyphMap;

// PROGRAM 2 LOOP 8: the customer loyalty hub. `/customer/loyalty/wallet`
// aggregates points, tiers, rewards, memberships and referrals across every
// business. Points shown here stay business-specific - the copy makes that
// explicit; they are never one spendable balance.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function SectionLabel({ title }: { title: string }) {
  return <Text style={styles.sectionLabel}>{title}</Text>;
}

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
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>MY REWARDS</Text>
        <Text style={styles.title}>Rewards</Text>
        <Text style={styles.subtitle}>Points, tiers, rewards and memberships across Chakusa.</Text>
      </View>

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
            <Pressable accessibilityRole="button" accessibilityLabel="Explore businesses" onPress={() => navigation.navigate('CustomerTabs', { screen: 'CustomerExplore' })} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}>
              <Ionicons name="compass-outline" size={18} color={authColors.onCoral} />
              <Text style={styles.primaryBtnText}>Explore businesses</Text>
            </Pressable>
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
          <SectionLabel title="Where you earn rewards" />
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
          <SectionLabel title="Recent points activity" />
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
      <View style={styles.tileIcon}><Ionicons name={icon} size={18} color={authColors.coral} /></View>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  firstUse: { gap: authSpace.md },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs, minHeight: 52, borderRadius: authRadius.pill, backgroundColor: authColors.coral, ...authShadow.cta },
  primaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.onCoral },
  quickRow: { flexDirection: 'row', gap: authSpace.sm },
  tile: { flex: 1, backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, padding: authSpace.md, alignItems: 'center', gap: authSpace.xxs, ...authShadow.card },
  tileIcon: { width: 32, height: 32, borderRadius: authRadius.pill, backgroundColor: authColors.coralSoft, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  tileValue: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: authColors.ink },
  tileLabel: { ...authType.body, fontSize: 11, textAlign: 'center' },
  sectionLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: authColors.ink, marginTop: authSpace.md, marginBottom: authSpace.xs },
  list: { gap: authSpace.xs },
  activity: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, paddingHorizontal: authSpace.md, ...authShadow.card },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, paddingVertical: authSpace.sm, borderBottomWidth: 1, borderBottomColor: authColors.lineSoft },
  activityCopy: { flex: 1, minWidth: 0 },
  activityLabel: { ...authType.body, fontSize: 13, color: authColors.ink },
  activityMeta: { ...authType.micro, textTransform: 'none', letterSpacing: 0, fontSize: 11, marginTop: 2 },
  delta: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.positive },
  deltaNegative: { color: authColors.ink },
  footnote: { ...authType.body, fontSize: 12, marginTop: authSpace.sm },
});
