import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, LoadingState, PrimaryButton, Screen, SecondaryButton, SectionHeader } from '../../components/ui';
import type { LoyaltyAccountSummaryDto } from '../../apiTypes';
import { formatPoints, sortRewards } from '../../domain/loyalty';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { RewardCard, TierProgressBar } from '../components/loyalty';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerLoyaltyBusiness'>;

// PROGRAM 2 LOOP 8: "what do I have with this business, and what's next".
// `/customer/loyalty/accounts/:businessId` (businessId, not slug). Join,
// tier, rewards, membership entry and points history all hang off here.

export function CustomerLoyaltyBusinessScreen({ route, navigation }: Props) {
  const { businessId, slug, businessName } = route.params;
  const [account, setAccount] = useState<LoyaltyAccountSummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setAccount(await loyaltyApi.account(businessId)); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load this loyalty account.'); }
    finally { setLoaded(true); }
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  const join = async () => {
    if (joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      await loyaltyApi.enrol(businessId);
      await load();
    } catch (caught) {
      setJoinError(caught instanceof ApiError ? caught.message : 'Could not join this reward program.');
    } finally {
      setJoining(false);
    }
  };

  if (!loaded) return <Screen><LoadingState label="Loading…" /></Screen>;
  if (error || !account) return <Screen><ErrorState message={error ?? 'Not found.'} onRetry={load} /></Screen>;

  const name = account.business?.name ?? businessName ?? 'This business';
  const rewards = sortRewards(account.availableRewards);
  const effectiveSlug = slug ?? account.business?.publicSlug ?? undefined;

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow="LOYALTY" title={name} subtitle={account.enrolled ? `${formatPoints(account.pointsBalance)} available` : account.programActive ? 'Rewards program available' : 'No rewards program yet'} />

      {!account.programActive ? (
        <EmptyState icon="gift-outline" title="No rewards here yet" message={`${name} isn’t running a rewards program right now.`} />
      ) : !account.enrolled ? (
        <View style={styles.joinCard}>
          <Text style={styles.joinTitle}>Join {name}’s rewards</Text>
          <Text style={styles.joinBody}>Earn points when you book and unlock rewards. It’s free to join.</Text>
          <PrimaryButton fullWidth label={joining ? 'Joining…' : 'Join rewards'} disabled={joining} onPress={() => void join()} />
          {joinError ? <Text style={styles.error}>{joinError}</Text> : null}
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <TierProgressBar account={account} />
            {account.tier.perks && account.tier.perks.length ? (
              <View style={styles.perks}>
                {account.tier.perks.map((perk, index) => <Text key={index} style={styles.perk}>• {perk}</Text>)}
              </View>
            ) : null}
            {account.pointExpiryDays != null ? (
              <Text style={styles.expiry}>Points expire {account.pointExpiryDays} days after they’re earned.</Text>
            ) : null}
          </View>

          <View style={styles.actions}>
            <SecondaryButton fullWidth icon="time-outline" label="Points history" onPress={() => navigation.navigate('CustomerLoyaltyHistory', { businessId, businessName: name })} />
            {effectiveSlug ? (
              <SecondaryButton fullWidth icon="star-outline" label="Memberships" onPress={() => navigation.navigate('CustomerMembershipPlans', { slug: effectiveSlug, businessName: name })} />
            ) : null}
          </View>

          <SectionHeader title="Rewards" />
          {!rewards.length ? (
            <EmptyState icon="ticket-outline" title="No rewards listed" message={`${name} hasn’t added any rewards to redeem yet. Keep earning points.`} />
          ) : (
            <View style={styles.list}>
              {rewards.map((reward) => (
                <RewardCard
                  key={reward.id}
                  reward={reward}
                  currency={null}
                  onPress={() => navigation.navigate('CustomerRewardDetail', { businessId, businessName: name, reward })}
                />
              ))}
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  joinCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  joinTitle: { ...typography.subheading, color: colors.text },
  joinBody: { ...typography.caption, color: colors.textSecondary },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  perks: { gap: spacing.xxs },
  perk: { ...typography.caption, color: colors.textSecondary },
  expiry: { ...typography.caption, color: colors.textSecondary },
  actions: { gap: spacing.sm },
  list: { gap: spacing.xs },
  error: { ...typography.caption, color: colors.negative },
});
