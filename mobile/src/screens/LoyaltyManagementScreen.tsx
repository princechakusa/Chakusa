import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader, EmptyState, ErrorState, LoadingState, MetricCard, PrimaryButton, Screen, SectionHeader, StatusBadge } from '../components/ui';
import { BusinessRedemptionDto, LoyaltyBusinessAnalyticsDto, LoyaltyProgramDto } from '../apiTypes';
import { ApiError } from '../services/api';
import { businessLoyaltyApi } from '../services/businessLoyalty';
import { analyticsTiles, programStatusLabel, redemptionStatusLabel, tierBreakdownRows } from '../domain/loyaltyBusiness';
import { useAuth } from '../state/AuthContext';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDateTime, titleCase } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'LoyaltyManagement'>;

type IconName = keyof typeof Ionicons.glyphMap;

export function LoyaltyManagementScreen({ navigation }: Props) {
  const { role } = useAuth();
  const canManage = role === 'OWNER' || role === 'ADMIN';
  const [program, setProgram] = useState<LoyaltyProgramDto | null>(null);
  const [analytics, setAnalytics] = useState<LoyaltyBusinessAnalyticsDto | null>(null);
  const [redemptions, setRedemptions] = useState<BusinessRedemptionDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [programResult, analyticsResult, redemptionResult] = await Promise.all([
        businessLoyaltyApi.getProgram(),
        businessLoyaltyApi.analytics().catch(() => null),
        businessLoyaltyApi.listRedemptions().catch(() => [] as BusinessRedemptionDto[]),
      ]);
      setProgram(programResult);
      setAnalytics(analyticsResult);
      setRedemptions(redemptionResult.slice(0, 5));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load your loyalty program.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const status = programStatusLabel(program);
  const notSetUp = status === 'Not set up';

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow="LOYALTY & REWARDS" title="Loyalty" subtitle="Reward customers for booking, reviewing and referring — points, tiers, rewards and memberships." />

      {!loaded ? (
        <LoadingState label="Loading your loyalty program…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : (
        <>
          <Pressable
            accessibilityRole={canManage ? 'button' : undefined}
            accessibilityLabel={`Loyalty program status: ${status}. ${canManage ? 'Open program settings.' : ''}`}
            disabled={!canManage}
            onPress={() => navigation.navigate('LoyaltyProgramSettings')}
            style={({ pressed }) => [styles.statusCard, pressed && styles.pressed]}
          >
            <View style={styles.statusTop}>
              <View style={[styles.statusIcon, status === 'Active' && styles.statusIconActive]}>
                <Ionicons name="ribbon-outline" size={22} color={status === 'Active' ? colors.success : colors.primary} />
              </View>
              <View style={styles.statusCopy}>
                <Text style={styles.statusTitle}>Program {status.toLowerCase()}</Text>
                <Text style={styles.statusDetail}>
                  {notSetUp
                    ? 'Set your point values and tiers to switch loyalty on.'
                    : `${program?.pointsPerCurrency ?? 0} point${program?.pointsPerCurrency === 1 ? '' : 's'} per unit spent${program?.welcomeBonus ? ` · ${program.welcomeBonus} pt welcome bonus` : ''}`}
                </Text>
              </View>
              {canManage ? <Ionicons name="chevron-forward" size={18} color={colors.tabInactive} /> : null}
            </View>
            {!notSetUp ? <StatusBadge label={status} /> : null}
          </Pressable>

          {notSetUp ? (
            <EmptyState
              icon="ribbon-outline"
              title="Loyalty isn't set up yet"
              message="Turn on a loyalty program to give your customers points for completed bookings and reviews, unlock rewards at tiers you choose, and offer memberships."
            />
          ) : null}

          {analytics && !notSetUp ? (
            <>
              <SectionHeader title="Last 30 days" />
              <View style={styles.tiles}>
                {analyticsTiles(analytics).map((tile) => (
                  <View key={tile.key} style={styles.tileWrap}>
                    <MetricCard label={tile.label} value={tile.value} detail={tile.detail} />
                  </View>
                ))}
              </View>

              {tierBreakdownRows(analytics).length ? (
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Members by tier</Text>
                  {tierBreakdownRows(analytics).map((row) => (
                    <View key={row.tier} style={styles.tierRow} accessibilityLabel={`${titleCase(row.tier)}: ${row.count} members, ${Math.round(row.share * 100)} percent`}>
                      <Text style={styles.tierName}>{titleCase(row.tier)}</Text>
                      <View style={styles.tierBarTrack}>
                        <View style={[styles.tierBarFill, { width: `${Math.max(4, row.share * 100)}%` }]} />
                      </View>
                      <Text style={styles.tierCount}>{row.count}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}

          <SectionHeader title="Manage" />
          <View style={styles.menuCard}>
            <MenuRow icon="settings-outline" title="Program settings" detail="Point values, expiry, welcome bonus, tiers" onPress={() => navigation.navigate('LoyaltyProgramSettings')} disabled={!canManage} />
            <MenuRow icon="gift-outline" title="Rewards" detail="What customers can unlock with points" onPress={() => navigation.navigate('LoyaltyRewards')} />
            <MenuRow icon="card-outline" title="Membership plans" detail="Member pricing and priority booking" onPress={() => navigation.navigate('LoyaltyMembershipPlans')} />
            <MenuRow icon="flash-outline" title="Campaigns" detail="Time-boxed bonus points and multipliers" onPress={() => navigation.navigate('LoyaltyCampaigns')} />
            <MenuRow icon="people-outline" title="Members" detail={analytics ? `${analytics.members} enrolled · adjust points` : 'Enrolled customers · adjust points'} onPress={() => navigation.navigate('LoyaltyMembers')} />
            <MenuRow icon="qr-code-outline" title="Redeem a reward" detail="Look up and honour a customer's code" onPress={() => navigation.navigate('LoyaltyRedemptions')} last />
          </View>

          {redemptions.length ? (
            <>
              <SectionHeader title="Recent redemptions" action="View all" onAction={() => navigation.navigate('LoyaltyRedemptions')} />
              <View style={styles.menuCard}>
                {redemptions.map((redemption, index) => (
                  <Pressable
                    key={redemption.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${redemption.reward?.name ?? 'Reward'}, ${redemptionStatusLabel(redemption.status)}, issued ${formatDateTime(redemption.issuedAt)}`}
                    onPress={() => navigation.navigate('LoyaltyRedemptions', { code: redemption.code })}
                    style={({ pressed }) => [styles.redemptionRow, index < redemptions.length - 1 && styles.rowBorder, pressed && styles.pressed]}
                  >
                    <View style={styles.redemptionCopy}>
                      <Text style={styles.redemptionName}>{redemption.reward?.name ?? 'Reward'}</Text>
                      <Text style={styles.redemptionMeta}>{redemption.code} · {formatDateTime(redemption.issuedAt)}</Text>
                    </View>
                    <StatusBadge label={redemptionStatusLabel(redemption.status)} />
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {notSetUp && canManage ? <PrimaryButton fullWidth icon="add" label="Set up loyalty" onPress={() => navigation.navigate('LoyaltyProgramSettings')} /> : null}
        </>
      )}
    </Screen>
  );
}

function MenuRow({ icon, title, detail, onPress, last, disabled }: { icon: IconName; title: string; detail: string; onPress: () => void; last?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, !last && styles.rowBorder, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.menuIcon}><Ionicons name={icon} size={20} color={colors.primary} /></View>
      <View style={styles.menuCopy}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuDetail}>{detail}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.tabInactive} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  statusCard: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  statusTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  statusIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  statusIconActive: { backgroundColor: colors.successSoft },
  statusCopy: { flex: 1, minWidth: 0 },
  statusTitle: { ...typography.bodyStrong, color: colors.text },
  statusDetail: { ...typography.caption, color: colors.textSecondary },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tileWrap: { width: '47%', flexGrow: 1 },
  card: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  cardTitle: { ...typography.subheading, color: colors.text },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tierName: { ...typography.caption, color: colors.text, width: 76 },
  tierBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.divider, overflow: 'hidden' },
  tierBarFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary },
  tierCount: { ...typography.caption, color: colors.textSecondary, width: 32, textAlign: 'right' },
  menuCard: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 60 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  menuIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  menuCopy: { flex: 1, minWidth: 0 },
  menuTitle: { ...typography.bodyStrong, color: colors.text },
  menuDetail: { ...typography.caption, color: colors.textSecondary },
  redemptionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 56 },
  redemptionCopy: { flex: 1, minWidth: 0 },
  redemptionName: { ...typography.bodyStrong, color: colors.text },
  redemptionMeta: { ...typography.caption, color: colors.textSecondary },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.45 },
});
