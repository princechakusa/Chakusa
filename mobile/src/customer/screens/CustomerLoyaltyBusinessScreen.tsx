import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { LoyaltyAccountSummaryDto } from '../../apiTypes';
import { formatPoints, sortRewards } from '../../domain/loyalty';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { RewardCard, TierProgressBar } from '../components/loyalty';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerLoyaltyBusiness'>;

// PROGRAM 2 LOOP 8: "what do I have with this business, and what's next".
// `/customer/loyalty/accounts/:businessId` (businessId, not slug). Join,
// tier, rewards, membership entry and points history all hang off here.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function SectionLabel({ title }: { title: string }) {
  return <Text style={styles.sectionLabel}>{title}</Text>;
}

function PrimaryBtn({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryBtn, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryBtn({ label, icon, onPress }: { label: string; icon?: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.secondaryBtn, pressed && styles.pressed]}>
      {icon ? <Ionicons name={icon} size={17} color={authColors.ink} /> : null}
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

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

  if (!loaded) return <Screen backgroundColor={authColors.bg}><LoadingState label="Loading…" /></Screen>;
  if (error || !account) return <Screen backgroundColor={authColors.bg}><ErrorState message={error ?? 'Not found.'} onRetry={load} /></Screen>;

  const name = account.business?.name ?? businessName ?? 'This business';
  const rewards = sortRewards(account.availableRewards);
  const effectiveSlug = slug ?? account.business?.publicSlug ?? undefined;

  return (
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>LOYALTY</Text>
        <Text style={styles.title}>{name}</Text>
        <Text style={styles.subtitle}>{account.enrolled ? `${formatPoints(account.pointsBalance)} available` : account.programActive ? 'Rewards program available' : 'No rewards program yet'}</Text>
      </View>

      {!account.programActive ? (
        <EmptyState icon="gift-outline" title="No rewards here yet" message={`${name} isn’t running a rewards program right now.`} />
      ) : !account.enrolled ? (
        <View style={styles.joinCard}>
          <Text style={styles.joinTitle}>Join {name}’s rewards</Text>
          <Text style={styles.joinBody}>Earn points when you book and unlock rewards. It’s free to join.</Text>
          <PrimaryBtn label={joining ? 'Joining…' : 'Join rewards'} disabled={joining} onPress={() => void join()} />
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
            <SecondaryBtn icon="time-outline" label="Points history" onPress={() => navigation.navigate('CustomerLoyaltyHistory', { businessId, businessName: name })} />
            {effectiveSlug ? (
              <SecondaryBtn icon="star-outline" label="Memberships" onPress={() => navigation.navigate('CustomerMembershipPlans', { slug: effectiveSlug, businessName: name })} />
            ) : null}
          </View>

          <SectionLabel title="Rewards" />
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
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  sectionLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: authColors.ink, marginTop: authSpace.md, marginBottom: authSpace.xs },
  joinCard: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, padding: authSpace.md, gap: authSpace.sm, ...authShadow.card },
  joinTitle: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: authColors.ink },
  joinBody: { ...authType.body, fontSize: 13 },
  card: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, padding: authSpace.md, gap: authSpace.sm, ...authShadow.card },
  perks: { gap: authSpace.xxs },
  perk: { ...authType.body, fontSize: 13 },
  expiry: { ...authType.body, fontSize: 12 },
  actions: { gap: authSpace.sm },
  list: { gap: authSpace.xs },
  error: { ...authType.body, fontSize: 12, color: authColors.danger },
  primaryBtn: { minHeight: 52, borderRadius: authRadius.pill, backgroundColor: authColors.coral, alignItems: 'center', justifyContent: 'center', ...authShadow.cta },
  primaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.onCoral },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs, minHeight: 52, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.ink },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
