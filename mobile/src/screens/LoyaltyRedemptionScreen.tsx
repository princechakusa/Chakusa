import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppHeader, EmptyState, ErrorState, LoadingState, PrimaryButton, Screen, SecondaryButton, StatusBadge } from '../components/ui';
import { BusinessRedemptionDto } from '../apiTypes';
import { ApiError } from '../services/api';
import { businessLoyaltyApi } from '../services/businessLoyalty';
import { canMarkRedeemed, canRevoke, normaliseRedemptionCode, redemptionStatusLabel } from '../domain/loyaltyBusiness';
import { redemptionCodeDisplay, rewardValueLabel } from '../domain/loyalty';
import { useAuth } from '../state/AuthContext';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDateTime } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'LoyaltyRedemptions'>;

const FILTERS = ['All', 'Issued', 'Redeemed', 'Expired', 'Revoked'] as const;
type Filter = (typeof FILTERS)[number];

export function LoyaltyRedemptionScreen({ route }: Props) {
  const { role } = useAuth();
  const canManage = role === 'OWNER' || role === 'ADMIN';
  const [code, setCode] = useState(route.params?.code ? normaliseRedemptionCode(route.params.code) : '');
  const [filter, setFilter] = useState<Filter>('All');
  const [rows, setRows] = useState<BusinessRedemptionDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (opts: { code?: string; status?: string } = {}) => {
    try {
      setRows(await businessLoyaltyApi.listRedemptions({
        code: opts.code || undefined,
        status: opts.status,
      }));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load redemptions.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void load(route.params?.code ? { code: normaliseRedemptionCode(route.params.code) } : {}); }, [load, route.params?.code]);

  const search = () => void load(code ? { code } : { status: filter === 'All' ? undefined : filter.toLowerCase() });
  const applyFilter = (next: Filter) => { setFilter(next); setCode(''); void load({ status: next === 'All' ? undefined : next.toLowerCase() }); };

  const markRedeemed = (redemption: BusinessRedemptionDto) => {
    setBusyId(redemption.id);
    businessLoyaltyApi.markRedeemed(redemption.id)
      .then(() => load(code ? { code } : { status: filter === 'All' ? undefined : filter.toLowerCase() }))
      .catch((caught: unknown) => Alert.alert('Could not mark redeemed', caught instanceof ApiError ? caught.message : 'Please try again.'))
      .finally(() => setBusyId(null));
  };
  const revoke = (redemption: BusinessRedemptionDto) => {
    Alert.alert('Revoke this reward?', 'The customer can no longer use this code. Any points they spent are refunded.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: () => {
          setBusyId(redemption.id);
          businessLoyaltyApi.revokeRedemption(redemption.id, 'Revoked from the mobile app', true)
            .then(() => load(code ? { code } : { status: filter === 'All' ? undefined : filter.toLowerCase() }))
            .catch((caught: unknown) => Alert.alert('Could not revoke', caught instanceof ApiError ? caught.message : 'Please try again.'))
            .finally(() => setBusyId(null));
        },
      },
    ]);
  };

  const filtersBar = useMemo(() => FILTERS, []);

  return (
    <Screen refreshing={loaded && !error} onRefresh={search}>
      <AppHeader eyebrow="LOYALTY & REWARDS" title="Redeem a reward" subtitle="Enter the code a customer shows you, honour the reward, then mark it redeemed." />

      <View style={styles.searchCard}>
        <View style={styles.searchRow}>
          <Ionicons name="pricetag-outline" size={18} color={colors.textSecondary} />
          <TextInput
            accessibilityLabel="Redemption code"
            autoCapitalize="characters"
            autoCorrect={false}
            value={code}
            onChangeText={(v) => setCode(normaliseRedemptionCode(v))}
            onSubmitEditing={search}
            placeholder="e.g. RW-12AB34CD"
            placeholderTextColor={colors.textSecondary}
            style={styles.searchInput}
          />
        </View>
        <PrimaryButton fullWidth compact icon="search" label="Look up code" onPress={search} disabled={code.length < 3} />
      </View>

      <View style={styles.filters}>
        {filtersBar.map((option) => (
          <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected: filter === option }} onPress={() => applyFilter(option)} style={[styles.filter, filter === option && !code && styles.filterActive]}>
            <Text style={[styles.filterText, filter === option && !code && styles.filterTextActive]}>{option}</Text>
          </Pressable>
        ))}
      </View>

      {!loaded ? <LoadingState label="Loading…" />
        : error ? <ErrorState message={error} onRetry={search} />
        : !rows.length ? <EmptyState icon="pricetag-outline" title={code ? 'No reward for that code' : 'No redemptions'} message={code ? 'Double-check the code with the customer. Codes look like RW-XXXXXXXX.' : 'When a customer redeems a reward it appears here for you to honour.'} />
        : (
          <View style={styles.list}>
            {rows.map((redemption) => (
              <View key={redemption.id} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.copy}>
                    <Text style={styles.name}>{redemption.reward?.name ?? 'Reward'}</Text>
                    <Text style={styles.detail}>{redemption.reward ? rewardValueLabel(redemption.reward) : ''}{redemption.pointsSpent ? ` · ${redemption.pointsSpent} pts spent` : ''}</Text>
                  </View>
                  <StatusBadge label={redemptionStatusLabel(redemption.status)} />
                </View>
                <View style={styles.codeRow}>
                  <Text style={styles.code} accessibilityLabel={`Code ${redemptionCodeDisplay(redemption.code)}`}>{redemptionCodeDisplay(redemption.code)}</Text>
                </View>
                <Text style={styles.meta}>
                  Issued {formatDateTime(redemption.issuedAt)}
                  {redemption.redeemedAt ? ` · Redeemed ${formatDateTime(redemption.redeemedAt)}` : ''}
                  {redemption.expiresAt && !redemption.redeemedAt ? ` · Expires ${formatDateTime(redemption.expiresAt)}` : ''}
                  {redemption.revokedReason ? ` · ${redemption.revokedReason}` : ''}
                </Text>
                {canManage ? (
                  <View style={styles.actions}>
                    {canMarkRedeemed(redemption.status, redemption.expiresAt) ? <PrimaryButton compact label={busyId === redemption.id ? 'Working…' : 'Mark redeemed'} onPress={() => markRedeemed(redemption)} disabled={busyId === redemption.id} /> : null}
                    {canRevoke(redemption.status) ? <SecondaryButton compact label="Revoke" onPress={() => revoke(redemption)} disabled={busyId === redemption.id} /> : null}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  searchCard: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 48, paddingHorizontal: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  searchInput: { flex: 1, ...typography.body, color: colors.text },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  filter: { minHeight: 36, paddingHorizontal: spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: radius.round, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  filterText: { ...typography.caption, color: colors.textSecondary },
  filterTextActive: { color: colors.primary, fontWeight: '700' },
  list: { gap: spacing.sm },
  card: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  copy: { flex: 1, minWidth: 0 },
  name: { ...typography.bodyStrong, color: colors.text },
  detail: { ...typography.caption, color: colors.textSecondary },
  codeRow: { paddingVertical: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.md, backgroundColor: colors.background, alignSelf: 'flex-start' },
  code: { ...typography.subheading, color: colors.text, letterSpacing: 1 },
  meta: { ...typography.caption, color: colors.textSecondary },
  actions: { flexDirection: 'row', gap: spacing.xs },
});
