import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CustomerMembershipDto, LoyaltyRewardDto, RewardRedemptionDto, WalletDto } from '../../apiTypes';
import { formatPoints, membershipStatusLabel, rewardValueLabel, tierProgress } from '../../domain/loyalty';
import type { LoyaltyAccountSummaryDto } from '../../apiTypes';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { formatDate } from '../../utils/format';
import { rewardEligibilityReason, redemptionStatusLabel } from '../domain/customerLoyalty';
import type { HubBusiness } from '../domain/customerLoyalty';

// PROGRAM 2 LOOP 8: presentational loyalty pieces. Theme tokens only; all
// values come from the server. No color-only status — every state also has
// text.

export function PointsSummary({ total, caption }: { total: number; caption: string }) {
  return (
    <View style={styles.points} accessibilityLabel={`${formatPoints(total)} total. ${caption}.`}>
      <Text style={styles.pointsValue}>{formatPoints(total)}</Text>
      <Text style={styles.pointsCaption}>{caption}</Text>
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
      <Ionicons name="chevron-forward" size={16} color={colors.tabInactive} />
    </Pressable>
  );
}

export function TierProgressBar({ account }: { account: LoyaltyAccountSummaryDto }) {
  const progress = tierProgress(account);
  const pct = Math.round(progress.ratio * 100);
  const label = progress.nextTier
    ? `${progress.currentTier} tier. ${formatPoints(progress.pointsAway)} to ${progress.nextTier}. ${pct}% of the way.`
    : `${progress.currentTier} tier — top tier reached.`;
  return (
    <View style={styles.tier} accessibilityLabel={label}>
      <View style={styles.tierRow}>
        <Text style={styles.tierName}>{progress.currentTier}</Text>
        <Text style={styles.tierNext}>
          {progress.nextTier ? `${formatPoints(progress.pointsAway)} to ${progress.nextTier}` : 'Top tier'}
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
      <Ionicons name={reward.redeemable ? 'chevron-forward' : 'lock-closed-outline'} size={16} color={reward.redeemable ? colors.primary : colors.tabInactive} />
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
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.tabInactive} /> : null}
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
      <Text style={styles.codeLabel}>{redemption.reward?.name ?? 'Reward'}</Text>
      <Text style={styles.codeBusiness}>{redemption.business?.name ?? ''}</Text>
      <Text style={styles.code} accessibilityLabel={`Redemption code ${code.split('').join(' ')}`}>{code}</Text>
      <Text style={styles.codeMeta}>
        {redemptionStatusLabel(redemption.status)}
        {redemption.expiresAt ? ` · expires ${formatDate(redemption.expiresAt)}` : ''}
      </Text>
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
  points: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, gap: spacing.xxs, ...shadows.card },
  pointsValue: { ...typography.title, color: colors.text },
  pointsCaption: { ...typography.caption, color: colors.textSecondary },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  rewardCard: { alignItems: 'flex-start' },
  pressed: { opacity: 0.78 },
  logo: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  logoText: { ...typography.bodyStrong, color: colors.primary },
  cardCopy: { flex: 1, minWidth: 0, gap: 2 },
  cardName: { ...typography.bodyStrong, color: colors.text },
  cardMeta: { ...typography.caption, color: colors.textSecondary },
  reason: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xxs },
  reasonReady: { color: colors.success },
  tier: { gap: spacing.xs },
  tierRow: { flexDirection: 'row', justifyContent: 'space-between' },
  tierName: { ...typography.bodyStrong, color: colors.text },
  tierNext: { ...typography.caption, color: colors.textSecondary },
  track: { height: 8, borderRadius: radius.round, backgroundColor: colors.divider, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.round, backgroundColor: colors.primary },
  codeCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, padding: spacing.lg, gap: spacing.xxs, alignItems: 'center' },
  codeLabel: { ...typography.bodyStrong, color: colors.text },
  codeBusiness: { ...typography.caption, color: colors.textSecondary },
  code: { ...typography.heading, color: colors.text, letterSpacing: 2, marginVertical: spacing.xs },
  codeMeta: { ...typography.caption, color: colors.textSecondary },
  codeHint: { ...typography.caption, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  referral: { flexDirection: 'row', gap: spacing.sm },
  referralStat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, alignItems: 'center', gap: spacing.xxs },
  referralValue: { ...typography.heading, color: colors.text },
  referralLabel: { ...typography.caption, color: colors.textSecondary },
});
