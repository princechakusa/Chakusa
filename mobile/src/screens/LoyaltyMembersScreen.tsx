import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader, Avatar, EmptyState, ErrorState, LoadingState, PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { FieldLabel, FormError, FormModal, NumberField, Segmented, TextField } from '../components/loyaltyForms';
import { LoyaltyMemberDto } from '../apiTypes';
import { ApiError } from '../services/api';
import { businessLoyaltyApi } from '../services/businessLoyalty';
import { AdjustmentDraft, projectedBalance, resolveAdjustment } from '../domain/loyaltyBusiness';
import { formatPoints } from '../domain/loyalty';
import { useAuth } from '../state/AuthContext';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDateTime, titleCase } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'LoyaltyMembers'>;

const blankAdjust: AdjustmentDraft = { amount: '', direction: 'add', reason: '' };

export function LoyaltyMembersScreen({ route }: Props) {
  const { role } = useAuth();
  const canManage = role === 'OWNER' || role === 'ADMIN';
  const [members, setMembers] = useState<LoyaltyMemberDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const [adjusting, setAdjusting] = useState<LoyaltyMemberDto | null>(null);
  const [adjustDraft, setAdjustDraft] = useState<AdjustmentDraft>(blankAdjust);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<{ name: string; balanceAfter: number; tierChanged: boolean } | null>(null);

  const pageSize = 25;
  const load = useCallback(async (nextPage: number, append: boolean) => {
    try {
      const result = await businessLoyaltyApi.listMembers({ page: nextPage, pageSize, tierKey: route.params?.tierKey });
      setMembers((current) => (append ? [...current, ...result.items] : result.items));
      setTotal(result.total);
      setPage(nextPage);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load members.');
    } finally {
      setLoaded(true);
      setLoadingMore(false);
    }
  }, [route.params?.tierKey]);

  useEffect(() => { void load(1, false); }, [load]);

  const hasMore = members.length < total;
  const loadMore = () => { if (loadingMore || !hasMore) return; setLoadingMore(true); void load(page + 1, true); };

  const openAdjust = (member: LoyaltyMemberDto) => { setAdjustDraft(blankAdjust); setAdjusting(member); setAdjustError(null); setConfirmation(null); };
  const setAdjust = <K extends keyof AdjustmentDraft>(key: K, value: AdjustmentDraft[K]) => setAdjustDraft((current) => ({ ...current, [key]: value }));

  const submitAdjust = async () => {
    if (!adjusting || saving) return;
    const check = resolveAdjustment(adjustDraft);
    if (!check.ok) { setAdjustError(check.error); return; }
    setSaving(true); setAdjustError(null);
    try {
      const result = await businessLoyaltyApi.adjustPoints(adjusting.customerProfileId, check.points!, check.reason!);
      setConfirmation({ name: adjusting.name, balanceAfter: result.balanceAfter, tierChanged: result.tierChanged });
      setAdjusting(null);
      await load(1, false);
    } catch (caught) {
      setAdjustError(caught instanceof ApiError ? caught.message : 'Could not adjust points.');
    } finally { setSaving(false); }
  };

  const check = resolveAdjustment(adjustDraft);

  return (
    <>
      <Screen
        refreshing={loaded && !error}
        onRefresh={() => void load(1, false)}
      >
        <AppHeader eyebrow="LOYALTY & REWARDS" title="Members" subtitle={route.params?.tierKey ? `${titleCase(route.params.tierKey)} tier` : `${total} enrolled customer${total === 1 ? '' : 's'}`} />

        {confirmation ? (
          <View style={styles.confirm}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.confirmText}>{confirmation.name}: balance is now {formatPoints(confirmation.balanceAfter)}{confirmation.tierChanged ? ' · tier changed' : ''}.</Text>
          </View>
        ) : null}

        {!loaded ? <LoadingState label="Loading members…" />
          : error && !members.length ? <ErrorState message={error} onRetry={() => void load(1, false)} />
          : !members.length ? <EmptyState icon="people-outline" title="No members yet" message="Customers appear here once they earn their first points — from a completed booking, a review, or a manual credit." />
          : (
            <View style={styles.list}>
              {members.map((member) => (
                <Pressable
                  key={member.id}
                  accessibilityRole={canManage ? 'button' : undefined}
                  accessibilityLabel={`${member.name}. ${formatPoints(member.pointsBalance)}. ${member.tierKey ? titleCase(member.tierKey) + ' tier' : ''}. ${canManage ? 'Adjust points.' : ''}`}
                  disabled={!canManage}
                  onPress={() => openAdjust(member)}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <Avatar name={member.name} />
                  <View style={styles.copy}>
                    <Text style={styles.name}>{member.name}</Text>
                    <Text style={styles.meta}>{member.tierKey ? `${titleCase(member.tierKey)} · ` : ''}{formatPoints(member.pointsBalance)} · {member.lifetimePoints.toLocaleString('en-US')} lifetime</Text>
                    {member.lastActivityAt ? <Text style={styles.sub}>Last activity {formatDateTime(member.lastActivityAt)}</Text> : null}
                  </View>
                  {canManage ? <Ionicons name="create-outline" size={18} color={colors.tabInactive} /> : null}
                </Pressable>
              ))}
              {hasMore ? <SecondaryButton fullWidth label={loadingMore ? 'Loading…' : 'Load more'} onPress={loadMore} disabled={loadingMore} /> : null}
            </View>
          )}
      </Screen>

      <FormModal
        visible={Boolean(adjusting)}
        title={adjusting ? `Adjust points — ${adjusting.name}` : 'Adjust points'}
        busy={saving}
        submitLabel="Apply adjustment"
        onClose={() => setAdjusting(null)}
        onSubmit={() => void submitAdjust()}
      >
        <View style={styles.currentBalance}>
          <FieldLabel>Current balance</FieldLabel>
          <Text style={styles.balanceValue}>{adjusting ? formatPoints(adjusting.pointsBalance) : ''}</Text>
        </View>
        <Segmented label="Direction" options={['add', 'remove'] as const} value={adjustDraft.direction} onChange={(v) => setAdjust('direction', v)} renderLabel={(v) => (v === 'add' ? 'Add points' : 'Remove points')} />
        <NumberField label="Points" value={adjustDraft.amount} onChangeText={(v) => setAdjust('amount', v)} placeholder="100" />
        <TextField label="Reason (required — recorded in the audit trail)" value={adjustDraft.reason} onChangeText={(v) => setAdjust('reason', v)} multiline placeholder="e.g. Goodwill credit for a delayed appointment" />
        {adjusting && check.ok ? (
          <Text style={styles.projected}>New balance will be {formatPoints(projectedBalance(adjusting.pointsBalance, check.points!))} once the server confirms.</Text>
        ) : null}
        <FormError message={adjustError} />
      </FormModal>
    </>
  );
}

const styles = StyleSheet.create({
  confirm: { flexDirection: 'row', gap: spacing.xs, alignItems: 'center', padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.successSoft },
  confirmText: { flex: 1, ...typography.caption, color: colors.text },
  list: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  copy: { flex: 1, minWidth: 0 },
  name: { ...typography.bodyStrong, color: colors.text },
  meta: { ...typography.caption, color: colors.textSecondary },
  sub: { ...typography.caption, color: colors.tabInactive },
  pressed: { opacity: 0.72 },
  currentBalance: { gap: spacing.xs },
  balanceValue: { ...typography.heading, color: colors.text },
  projected: { ...typography.caption, color: colors.textSecondary },
});
