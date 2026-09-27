import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FieldLabel, FormError, FormModal, NumberField, Segmented, TextField } from '../components/loyaltyForms';
import { LoyaltyMemberDto } from '../apiTypes';
import { ApiError } from '../services/api';
import { businessLoyaltyApi } from '../services/businessLoyalty';
import { AdjustmentDraft, projectedBalance, resolveAdjustment } from '../domain/loyaltyBusiness';
import { formatPoints } from '../domain/loyalty';
import { useAuth } from '../state/AuthContext';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { RootStackParamList } from '../types';
import { formatDateTime, titleCase } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'LoyaltyMembers'>;

const blankAdjust: AdjustmentDraft = { amount: '', direction: 'add', reason: '' };

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function LoyaltyMembersScreen({ navigation, route }: Props) {
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
  const header = (
    <M3Header
      businessName="Members"
      onBack={() => navigation.goBack()}
      hasNotifications={false}
    />
  );

  return (
    <>
      <M3Screen header={header}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>Loyalty Members</Text>
          <Text style={styles.subtitle}>{route.params?.tierKey ? `${titleCase(route.params.tierKey)} tier` : `${total} enrolled customer${total === 1 ? '' : 's'}`}</Text>
        </View>

        {confirmation ? (
          <View style={styles.confirm}>
            <Icon name="check_circle" size={20} color={m3.secondary} />
            <Text style={styles.confirmText}>{confirmation.name}: balance is now {formatPoints(confirmation.balanceAfter)}{confirmation.tierChanged ? ' · tier changed' : ''}.</Text>
          </View>
        ) : null}

        {!loaded ? (
          <M3Loading label="Loading members…" />
        ) : error && !members.length ? (
          <M3Error message={error} onRetry={() => void load(1, false)} />
        ) : !members.length ? (
          <M3Empty icon="group" title="No members yet" message="Customers appear here once they earn their first points - from a completed booking, a review, or a manual credit." />
        ) : (
          <View style={styles.list}>
            {members.map((member) => (
              <M3Card
                key={member.id}
                onPress={canManage ? () => openAdjust(member) : undefined}
                style={styles.row}
              >
                <View style={styles.rowInner}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(member.name)}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text numberOfLines={1} style={styles.name}>{member.name}</Text>
                    <Text style={styles.meta}>{member.tierKey ? `${titleCase(member.tierKey)} · ` : ''}{formatPoints(member.pointsBalance)} · {member.lifetimePoints.toLocaleString('en-US')} lifetime</Text>
                    {member.lastActivityAt ? <Text style={styles.sub}>Last activity {formatDateTime(member.lastActivityAt)}</Text> : null}
                  </View>
                  {member.tierKey ? <Chip label={titleCase(member.tierKey)} tone="secondary" /> : null}
                  {canManage ? <Icon name="edit" size={18} color={m3.onSurfaceVariant} /> : null}
                </View>
              </M3Card>
            ))}
            {hasMore ? (
              <Pressable accessibilityRole="button" disabled={loadingMore} onPress={loadMore} style={styles.loadMore}>
                <Text style={styles.loadMoreText}>{loadingMore ? 'Loading…' : 'Load more'}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </M3Screen>

      <FormModal
        visible={Boolean(adjusting)}
        title={adjusting ? `Adjust points - ${adjusting.name}` : 'Adjust points'}
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
        <TextField label="Reason (required - recorded in the audit trail)" value={adjustDraft.reason} onChangeText={(v) => setAdjust('reason', v)} multiline placeholder="e.g. Goodwill credit for a delayed appointment" />
        {adjusting && check.ok ? (
          <Text style={styles.projected}>New balance will be {formatPoints(projectedBalance(adjusting.pointsBalance, check.points!))} once the server confirms.</Text>
        ) : null}
        <FormError message={adjustError} />
      </FormModal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  titleBlock: { gap: 2 },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },

  confirm: { flexDirection: 'row', gap: m3Space.xs, alignItems: 'center', padding: m3Space.sm, borderRadius: m3Radius.md, backgroundColor: 'rgba(134,242,228,0.35)' },
  confirmText: { flex: 1, ...m3Type.bodySm, color: m3.onSurface },

  list: { gap: m3Space.xs },
  row: { padding: 0 },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, padding: m3Space.md },
  avatar: { width: 44, height: 44, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...m3Type.labelLg, color: m3.primary },
  name: { ...m3Type.headlineSm, fontSize: 16, color: m3.onSurface },
  meta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  sub: { ...m3Type.labelXs, color: m3.onSurfaceVariant },

  loadMore: { height: 44, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  loadMoreText: { ...m3Type.labelMd, color: m3.onSurface },

  currentBalance: { gap: m3Space.xs },
  balanceValue: { ...m3Type.headlineMd, color: m3.onSurface },
  projected: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
});
