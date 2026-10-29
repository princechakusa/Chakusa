import { Ionicons } from '../../components/icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CustomerMembershipDto, LoyaltyRewardDto, RewardRedemptionDto, WalletDto } from '../../apiTypes';
import { formatPoints, membershipStatusLabel, rewardValueLabel, tierProgress } from '../../domain/loyalty';
import type { LoyaltyAccountSummaryDto } from '../../apiTypes';
import { authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { formatDate } from '../../utils/format';
import { rewardEligibilityReason, redemptionStatusLabel } from '../domain/customerLoyalty';
import type { HubBusiness } from '../domain/customerLoyalty';
import { premium } from '../premiumTheme';

// PROGRAM 2 LOOP 8: presentational loyalty pieces. Theme tokens only; all
// values come from the server. No color-only status - every state also has
// text.

export function PointsSummary({ total, caption }: { total: number; caption: string }) {
  return (
    <View style={styles.points} accessibilityLabel={`${formatPoints(total)} total. ${caption}.`}>
      <View style={styles.pointsIcon}><Ionicons name="sparkles" size={20} color={premium.deep} /></View>
      <View style={styles.pointsCopy}>
        <Text style={styles.pointsValue}>{formatPoints(total)}</Text>
        <Text style={styles.pointsCaption}>{caption}</Text>
      </View>
    </View>
  );
}

export function LoyaltyBusinessCard({ business, onPress }: { business: HubBusiness; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${business.name}. ${formatPoints(business.pointsBalance)}. ${business.tierName} tier.`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.logo}><Text style={styles.logoText}>{business.name.slice(0, 1).toUpperCase()}</Text></View>
      <View style={styles.cardCopy}>
        <Text style={styles.cardName} numberOfLines={1}>{business.name}</Text>
        <Text style={styles.cardMeta}>{business.tierName} · {formatPoints(business.pointsBalance)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={premium.inkFaint} />
    </Pressable>
  );
}

export function TierProgressBar({ account }: { account: LoyaltyAccountSummaryDto }) {
  const progress = tierProgress(account);
  const pct = Math.round(progress.ratio * 100);
  const label = progress.nextTier
    ? `${progress.currentTier} tier. ${formatPoints(progress.pointsAway)} to ${progress.nextTier}. ${pct}% of the way.`
    : `${progress.currentTier} tier - top tier reached.`;
  return (
    <View style={styles.tier} accessibilityLabel={label}>
      <View style={styles.tierRow}>
        <View style={styles.tierBadge}><Text style={styles.tierBadgeText}>{progress.currentTier}</Text></View>
        <Text style={styles.tierNext}>
          {progress.nextTier ? `${formatPoints(progress.pointsAway)} to ${progress.nextTier}` : 'Top tier reached'}
        </Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }} style={styles.track}>
        <View style={[styles.fill, { width: `${Math.max(4, pct)}%` }]} />
      </View>
    </View>
  );
}

export function RewardCard({ reward, currency, onPress }: { reward: LoyaltyRewardDto; currency: string | null; onPress: () => void }) {
  const reason = rewardEligibilityReason(reward);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${reward.name}. ${rewardValueLabel(reward)}. ${formatPoints(reward.pointsCost)}. ${reason}.`}
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.rewardCard, pressed && styles.pressed]}
    >
      <View style={styles.cardCopy}>
        <Text style={styles.cardName} numberOfLines={1}>{reward.name}</Text>
        <Text style={styles.cardMeta}>{rewardValueLabel(reward)}{currency && reward.type === 'fixed_discount' && reward.value != null ? '' : ''} · {formatPoints(reward.pointsCost)}</Text>
        <Text style={[styles.reason, reward.redeemable && styles.reasonReady]}>{reason}</Text>
      </View>
      <Ionicons name={reward.redeemable ? 'chevron-forward' : 'lock-closed-outline'} size={16} color={reward.redeemable ? premium.deep : premium.inkFaint} />
    </Pressable>
  );
}

export function MembershipCard({ membership, onPress }: { membership: CustomerMembershipDto; onPress?: () => void }) {
  const body = (
    <>
      <View style={styles.cardCopy}>
        <Text style={styles.cardName} numberOfLines={1}>{membership.plan.name}</Text>
        <Text style={styles.cardMeta}>{membership.business?.name ?? 'Membership'} · {membershipStatusLabel(membership)}</Text>
        {membership.plan.discountPercent > 0 ? <Text style={styles.cardMeta}>{membership.plan.discountPercent}% member discount</Text> : null}
        {membership.currentPeriodEnd ? <Text style={styles.cardMeta}>Renews {formatDate(membership.currentPeriodEnd)}</Text> : null}
      </View>
      {onPress ? <Ionicons name="chevron-forward" size={16} color={premium.inkFaint} /> : null}
    </>
  );
  if (!onPress) return <View style={[styles.card, styles.rewardCard]}>{body}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${membership.plan.name}. ${membershipStatusLabel(membership)}.`} onPress={onPress} style={({ pressed }) => [styles.card, styles.rewardCard, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

export function RedemptionCodeCard({ redemption, code }: { redemption: RewardRedemptionDto; code: string }) {
  return (
    <View style={styles.codeCard}>
      <View style={styles.codeStatusRow}>
        <View style={styles.codeStatusPill}><Text style={styles.codeStatusText}>{redemptionStatusLabel(redemption.status)}</Text></View>
      </View>
      <Text style={styles.codeLabel}>{redemption.reward?.name ?? 'Reward'}</Text>
      <Text style={styles.codeBusiness}>{redemption.business?.name ?? ''}</Text>
      <View style={styles.codeChip}>
        <Text style={styles.code} accessibilityLabel={`Redemption code ${code.split('').join(' ')}`}>{code}</Text>
      </View>
      {redemption.expiresAt ? <Text style={styles.codeMeta}>Expires {formatDate(redemption.expiresAt)}</Text> : null}
      <Text style={styles.codeHint}>Show this code to the business to use your reward.</Text>
    </View>
  );
}

export function ReferralProgressCard({ invited, joined, completed }: { invited: number; joined: number; completed: number }) {
  return (
    <View style={styles.referral} accessibilityLabel={`${invited} invited, ${joined} signed up, ${completed} completed.`}>
      <ReferralStat label="Invited" value={invited} />
      <ReferralStat label="Signed up" value={joined} />
      <ReferralStat label="Completed" value={completed} />
    </View>
  );
}
function ReferralStat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.referralStat}>
      <Text style={styles.referralValue}>{value}</Text>
      <Text style={styles.referralLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  points: { flexDirection: 'row', alignItems: 'center', gap: authSpace.md, backgroundColor: premium.card, borderRadius: authRadius.lg, borderWidth: 1, borderColor: premium.line, padding: authSpace.lg, ...authShadow.card },
  pointsIcon: { width: 48, height: 48, borderRadius: authRadius.pill, backgroundColor: premium.sageSoft, alignItems: 'center', justifyContent: 'center' },
  pointsCopy: { flex: 1, gap: authSpace.xxs },
  pointsValue: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, color: premium.ink },
  pointsCaption: { ...authType.body, fontSize: 12, color: premium.inkSoft },
  card: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, padding: authSpace.md, backgroundColor: premium.card, borderRadius: authRadius.md, borderWidth: 1, borderColor: premium.line },
  rewardCard: { alignItems: 'flex-start' },
  pressed: { opacity: 0.78 },
  logo: { width: 36, height: 36, borderRadius: authRadius.sm, backgroundColor: premium.sageSoft, alignItems: 'center', justifyContent: 'center' },
  logoText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: premium.deep },
  cardCopy: { flex: 1, minWidth: 0, gap: 2 },
  cardName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: premium.ink },
  cardMeta: { ...authType.body, fontSize: 12, color: premium.inkSoft },
  reason: { ...authType.body, fontSize: 12, color: premium.inkSoft, marginTop: authSpace.xxs },
  reasonReady: { color: '#1E7A55' },
  tier: { gap: authSpace.xs },
  tierRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tierBadge: { paddingHorizontal: authSpace.sm, paddingVertical: 3, borderRadius: authRadius.pill, backgroundColor: premium.sageSoft },
  tierBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: premium.deep },
  tierName: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: premium.ink },
  tierNext: { ...authType.body, fontSize: 12, color: premium.inkSoft },
  track: { height: 8, borderRadius: authRadius.pill, backgroundColor: premium.sageSoft, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: authRadius.pill, backgroundColor: premium.deep },
  codeCard: { backgroundColor: premium.card, borderRadius: authRadius.lg, borderWidth: 1, borderColor: premium.deep, padding: authSpace.lg, gap: authSpace.xxs, alignItems: 'center', ...authShadow.card },
  codeStatusRow: { alignSelf: 'stretch', alignItems: 'flex-end' },
  codeStatusPill: { paddingHorizontal: authSpace.sm, paddingVertical: 3, borderRadius: authRadius.pill, backgroundColor: '#EAF9F1' },
  codeStatusText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: '#1E7A55' },
  codeLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: premium.ink, marginTop: authSpace.xs },
  codeBusiness: { ...authType.body, fontSize: 12, color: premium.inkSoft },
  codeChip: { marginVertical: authSpace.sm, paddingHorizontal: authSpace.lg, paddingVertical: authSpace.sm, borderRadius: authRadius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: premium.deep, backgroundColor: premium.sageSoft },
  code: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 22, color: premium.ink, letterSpacing: 3 },
  codeMeta: { ...authType.body, fontSize: 12, color: premium.inkSoft },
  codeHint: { ...authType.body, fontSize: 12, color: premium.inkSoft, textAlign: 'center', marginTop: authSpace.xs },
  referral: { flexDirection: 'row', gap: authSpace.sm },
  referralStat: { flex: 1, backgroundColor: premium.card, borderRadius: authRadius.md, borderWidth: 1, borderColor: premium.line, padding: authSpace.md, alignItems: 'center', gap: authSpace.xxs },
  referralValue: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: premium.ink },
  referralLabel: { ...authType.body, fontSize: 12, color: premium.inkSoft },
});
