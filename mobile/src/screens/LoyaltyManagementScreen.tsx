import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BusinessRedemptionDto, LoyaltyBusinessAnalyticsDto, LoyaltyProgramDto } from '../apiTypes';
import { ApiError } from '../services/api';
import { businessLoyaltyApi } from '../services/businessLoyalty';
import { analyticsTiles, programStatusLabel, redemptionStatusLabel, tierBreakdownRows } from '../domain/loyaltyBusiness';
import { useAuth } from '../state/AuthContext';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen, SectionTitle } from '../experience/businessKit';
import { RootStackParamList } from '../types';
import { formatDateTime, titleCase } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'LoyaltyManagement'>;

const TILE_ICON: Record<string, string> = {
  members: 'group',
  enrolled: 'group',
  points: 'blur_circular',
  issued: 'blur_circular',
  claimed: 'redeem',
  redemptions: 'redeem',
  retention: 'trending_up',
};

function tileIcon(key: string) {
  const lower = key.toLowerCase();
  const match = Object.keys(TILE_ICON).find((needle) => lower.includes(needle));
  return match ? TILE_ICON[match] : 'insights';
}

const TIER_ICON = ['military_tech', 'workspace_premium', 'emoji_events', 'star'];

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
  const tiers = analytics ? tierBreakdownRows(analytics) : [];

  const header = (
    <M3Header
      businessName="Loyalty & Rewards"
      onBack={() => navigation.goBack()}
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      hasNotifications={false}
    />
  );

  return (
    <M3Screen header={header}>
      <View style={styles.titleRow}>
        <View style={styles.flex}>
          <Text style={styles.title}>Loyalty & Rewards Program</Text>
          <Text style={styles.subtitle}>Patron rewards configuration, multi-tier perks, and point ledger calibration.</Text>
        </View>
        {!notSetUp ? <Chip label={status} tone={status === 'Active' ? 'secondary' : 'neutral'} /> : null}
      </View>

      {!loaded ? (
        <M3Loading label="Loading your loyalty program…" />
      ) : error ? (
        <M3Error message={error} onRetry={() => void load()} />
      ) : (
        <>
          {notSetUp ? (
            <M3Empty
              icon="loyalty"
              title="Loyalty isn't set up yet"
              message="Turn on a loyalty program to give your customers points for completed bookings and reviews, unlock rewards at tiers you choose, and offer memberships."
            />
          ) : null}

          {analytics && !notSetUp ? (
            <View style={styles.statGrid}>
              {analyticsTiles(analytics).slice(0, 4).map((tile) => (
                <M3Card key={tile.key} style={styles.statCard}>
                  <View style={styles.statTop}>
                    <Text style={styles.statLabel}>{tile.label}</Text>
                    <View style={styles.statIcon}>
                      <Icon name={tileIcon(tile.key)} size={16} color={m3.primary} />
                    </View>
                  </View>
                  <Text style={styles.statValue}>{tile.value}</Text>
                  {tile.detail ? <Text style={styles.statDetail}>{tile.detail}</Text> : null}
                </M3Card>
              ))}
            </View>
          ) : null}

          {!notSetUp ? (
            <View style={styles.actionsRow}>
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate('LoyaltyRewards')} style={styles.actionPrimary}>
                <Icon name="add_circle" size={18} color={m3.onPrimary} />
                <Text style={styles.actionPrimaryText}>New Perk</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate('LoyaltyRedemptions')} style={styles.actionSecondary}>
                <Icon name="qr_code_2" size={18} color={m3.onSurface} />
                <Text style={styles.actionSecondaryText}>Quick Redeem</Text>
              </Pressable>
            </View>
          ) : null}

          <Pressable
            accessibilityRole={canManage ? 'button' : undefined}
            accessibilityLabel={`Loyalty program status: ${status}. ${canManage ? 'Open program settings.' : ''}`}
            disabled={!canManage}
            onPress={() => navigation.navigate('LoyaltyProgramSettings')}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <M3Card style={styles.rulesCard}>
              <View style={styles.rulesHead}>
                <View style={styles.flex}>
                  <Text style={styles.cardTitle}>Rules Configuration</Text>
                  <Text style={styles.cardSubtitle}>Automated ledger logic and earning criteria</Text>
                </View>
                {canManage ? <Icon name="tune" size={20} color={m3.onSurfaceVariant} /> : null}
              </View>
              <Text style={styles.rulesSummary}>
                {notSetUp
                  ? 'Set your point values and tiers to switch loyalty on.'
                  : `${program?.pointsPerCurrency ?? 0} point${program?.pointsPerCurrency === 1 ? '' : 's'} per unit spent${program?.welcomeBonus ? ` · ${program.welcomeBonus} pt welcome bonus` : ''}${program?.pointExpiryDays ? ` · expires after ${program.pointExpiryDays}d` : ''}`}
              </Text>
            </M3Card>
          </Pressable>

          {tiers.length ? (
            <View style={styles.section}>
              <SectionTitle title="Active Tier Structures" actionLabel="Edit Tiers" onAction={() => canManage && navigation.navigate('LoyaltyProgramSettings')} />
              {tiers.map((row, index) => (
                <M3Card key={row.tier} style={styles.tierCard}>
                  <View style={styles.tierTop}>
                    <View style={styles.tierIcon}>
                      <Icon name={TIER_ICON[index % TIER_ICON.length]} size={20} color={m3.primary} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.tierName}>{titleCase(row.tier)}</Text>
                    </View>
                    <Text style={styles.tierCount}>{row.count} Patrons</Text>
                  </View>
                  <View style={styles.tierBarTrack}>
                    <View style={[styles.tierBarFill, { width: `${Math.max(4, row.share * 100)}%` }]} />
                  </View>
                </M3Card>
              ))}
            </View>
          ) : null}

          {redemptions.length ? (
            <View style={styles.section}>
              <SectionTitle title="Active Perks & Rewards" actionLabel="View all" onAction={() => navigation.navigate('LoyaltyRedemptions')} />
              {redemptions.map((redemption) => (
                <Pressable
                  key={redemption.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${redemption.reward?.name ?? 'Reward'}, ${redemptionStatusLabel(redemption.status)}, issued ${formatDateTime(redemption.issuedAt)}`}
                  onPress={() => navigation.navigate('LoyaltyRedemptions', { code: redemption.code })}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <M3Card style={styles.rewardRow}>
                    <View style={styles.rewardIcon}>
                      <Icon name="redeem" size={18} color={m3.primary} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.rewardName}>{redemption.reward?.name ?? 'Reward'}</Text>
                      <Text style={styles.rewardMeta}>{redemption.code} · {formatDateTime(redemption.issuedAt)}</Text>
                    </View>
                    <Chip label={redemptionStatusLabel(redemption.status)} tone="neutral" />
                  </M3Card>
                </Pressable>
              ))}
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate('LoyaltyRewards')} style={styles.manageLink}>
                <Text style={styles.manageLinkText}>Manage Catalog Inventory & Stock Limits</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.section}>
            <SectionTitle title="Manage" />
            <M3Card padded={false}>
              <MenuRow icon="settings" title="Program settings" detail="Point values, expiry, welcome bonus, tiers" onPress={() => navigation.navigate('LoyaltyProgramSettings')} disabled={!canManage} />
              <MenuRow icon="card_giftcard" title="Rewards" detail="What customers can unlock with points" onPress={() => navigation.navigate('LoyaltyRewards')} />
              <MenuRow icon="badge" title="Membership plans" detail="Member pricing and priority booking" onPress={() => navigation.navigate('LoyaltyMembershipPlans')} />
              <MenuRow icon="bolt" title="Campaigns" detail="Time-boxed bonus points and multipliers" onPress={() => navigation.navigate('LoyaltyCampaigns')} />
              <MenuRow icon="group" title="Members" detail={analytics ? `${analytics.members} enrolled · adjust points` : 'Enrolled customers · adjust points'} onPress={() => navigation.navigate('LoyaltyMembers')} />
              <MenuRow icon="qr_code_2" title="Redeem a reward" detail="Look up and honour a customer's code" onPress={() => navigation.navigate('LoyaltyRedemptions')} last />
            </M3Card>
          </View>

          {notSetUp && canManage ? (
            <Pressable accessibilityRole="button" onPress={() => navigation.navigate('LoyaltyProgramSettings')} style={styles.setupBtn}>
              <Icon name="add" size={18} color={m3.onPrimary} />
              <Text style={styles.setupBtnText}>Set up loyalty</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </M3Screen>
  );
}

function MenuRow({ icon, title, detail, onPress, last, disabled }: { icon: string; title: string; detail: string; onPress: () => void; last?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${detail}`}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, !last && styles.rowBorder, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={styles.menuIcon}><Icon name={icon} size={18} color={m3.primary} /></View>
      <View style={styles.flex}>
        <Text style={styles.menuTitle}>{title}</Text>
        <Text style={styles.menuDetail}>{detail}</Text>
      </View>
      <Icon name="chevron_right" size={18} color={m3.onSurfaceVariant} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  section: { gap: m3Space.xs },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 4 },

  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },
  statCard: { width: '47%', flexGrow: 1, gap: 2 },
  statTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  statLabel: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  statIcon: { width: 26, height: 26, borderRadius: 13, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  statValue: { ...m3Type.headlineSm, color: m3.onSurface, marginTop: 2 },
  statDetail: { ...m3Type.labelXs, color: m3.secondary },

  actionsRow: { flexDirection: 'row', gap: m3Space.xs },
  actionPrimary: { flex: 1, height: 46, borderRadius: m3Radius.md, backgroundColor: m3.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionPrimaryText: { ...m3Type.labelLg, color: m3.onPrimary },
  actionSecondary: { flex: 1, height: 46, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainerLowest, borderWidth: 1, borderColor: m3.outlineVariant, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  actionSecondaryText: { ...m3Type.labelLg, color: m3.onSurface },

  rulesCard: { gap: m3Space.sm },
  rulesHead: { flexDirection: 'row', alignItems: 'flex-start', gap: m3Space.xs },
  cardTitle: { ...m3Type.titleMd, color: m3.onSurface },
  cardSubtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  rulesSummary: { ...m3Type.bodySm, color: m3.onSurface, backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.sm, padding: m3Space.sm },

  tierCard: { gap: m3Space.xs },
  tierTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tierIcon: { width: 38, height: 38, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  tierName: { ...m3Type.labelLg, color: m3.onSurface },
  tierCount: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  tierBarTrack: { height: 6, borderRadius: 3, backgroundColor: m3.surfaceContainerHigh, overflow: 'hidden' },
  tierBarFill: { height: 6, borderRadius: 3, backgroundColor: m3.primary },

  rewardRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  rewardIcon: { width: 36, height: 36, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  rewardName: { ...m3Type.labelLg, color: m3.onSurface },
  rewardMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  manageLink: { paddingVertical: m3Space.xs, alignItems: 'center' },
  manageLinkText: { ...m3Type.labelMd, color: m3.primary },

  menuRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, paddingHorizontal: m3Space.md, paddingVertical: m3Space.sm, minHeight: 60 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: m3.surfaceContainerHigh },
  menuIcon: { width: 36, height: 36, borderRadius: m3Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: m3.surfaceContainerHigh },
  menuTitle: { ...m3Type.labelLg, color: m3.onSurface },
  menuDetail: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.45 },

  setupBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 48, borderRadius: m3Radius.md, backgroundColor: m3.primary },
  setupBtnText: { ...m3Type.labelLg, color: m3.onPrimary },
});
