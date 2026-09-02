import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader, EmptyState, ErrorState, LoadingState, PrimaryButton, Screen, SecondaryButton, StatusBadge } from '../components/ui';
import { FormError, FormModal, NumberField, Segmented, SwitchRow, TextField } from '../components/loyaltyForms';
import { BusinessRewardDto, BusinessRewardInput, LoyaltyRewardType } from '../apiTypes';
import { ApiError } from '../services/api';
import { businessLoyaltyApi } from '../services/businessLoyalty';
import { RewardFormDraft, rewardTypeLabel, rewardValueSummary, validateRewardDraft } from '../domain/loyaltyBusiness';
import { useAuth } from '../state/AuthContext';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDate } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'LoyaltyRewards'>;

const TYPES: readonly LoyaltyRewardType[] = ['free_service', 'percent_discount', 'fixed_discount', 'promo', 'birthday', 'milestone'];

const blank: RewardFormDraft = { name: '', description: '', type: 'free_service', pointsCost: '500', value: '', minTierKey: '', membersOnly: false, autoGrant: false, milestoneBookings: '', redemptionValidityDays: '' };
const toDraft = (reward: BusinessRewardDto): RewardFormDraft => ({
  name: reward.name, description: reward.description ?? '', type: reward.type,
  pointsCost: String(reward.pointsCost), value: reward.value == null ? '' : String(reward.value),
  minTierKey: reward.minTierKey ?? '', membersOnly: reward.membersOnly, autoGrant: reward.autoGrant,
  milestoneBookings: reward.milestoneBookings == null ? '' : String(reward.milestoneBookings),
  redemptionValidityDays: reward.redemptionValidityDays == null ? '' : String(reward.redemptionValidityDays),
});

export function LoyaltyRewardsScreen(_props: Props) {
  const { role, business } = useAuth();
  const canManage = role === 'OWNER' || role === 'ADMIN';
  const currency = business?.currency ?? 'USD';
  const [rewards, setRewards] = useState<BusinessRewardDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BusinessRewardDto | 'new' | null>(null);
  const [draft, setDraft] = useState<RewardFormDraft>(blank);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setRewards(await businessLoyaltyApi.listRewards()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load rewards.'); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = (reward?: BusinessRewardDto) => { setDraft(reward ? toDraft(reward) : blank); setEditing(reward ?? 'new'); setFormError(null); };
  const set = <K extends keyof RewardFormDraft>(key: K, value: RewardFormDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (saving || !editing) return;
    const check = validateRewardDraft(draft);
    if (!check.ok) { setFormError(check.error); return; }
    setSaving(true); setFormError(null);
    const body: BusinessRewardInput = {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      type: draft.type,
      pointsCost: Number(draft.pointsCost || '0'),
      value: draft.value.trim() === '' ? undefined : Number(draft.value),
      minTierKey: draft.minTierKey.trim() || undefined,
      membersOnly: draft.membersOnly,
      autoGrant: draft.type === 'milestone' ? true : draft.autoGrant,
      milestoneBookings: draft.type === 'milestone' ? Number(draft.milestoneBookings) : undefined,
      redemptionValidityDays: draft.redemptionValidityDays.trim() === '' ? undefined : Number(draft.redemptionValidityDays),
    };
    try {
      if (editing === 'new') await businessLoyaltyApi.createReward(body);
      else await businessLoyaltyApi.updateReward(editing.id, body);
      setEditing(null);
      await load();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Could not save this reward.');
    } finally { setSaving(false); }
  };

  const toggleActive = (reward: BusinessRewardDto) => {
    const next = !reward.active;
    Alert.alert(next ? 'Reactivate this reward?' : 'Deactivate this reward?', next ? 'Customers will be able to redeem it again.' : 'Customers can no longer redeem it. Existing issued codes still work.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: next ? 'Reactivate' : 'Deactivate',
        style: next ? 'default' : 'destructive',
        onPress: () => void (next ? businessLoyaltyApi.updateReward(reward.id, { active: true }) : businessLoyaltyApi.deleteReward(reward.id)).then(load).catch(() => Alert.alert('Could not update reward', 'Please try again.')),
      },
    ]);
  };

  return (
    <>
      <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
        <AppHeader eyebrow="LOYALTY & REWARDS" title="Rewards" subtitle="What your customers can unlock with points. Types are shown to customers in plain language." />
        {!loaded ? <LoadingState label="Loading rewards…" />
          : error && !rewards.length ? <ErrorState message={error} onRetry={() => void load()} />
          : !rewards.length ? <EmptyState icon="gift-outline" title="No rewards yet" message="Add a reward customers can redeem — a free service, a percentage discount, or a milestone reward that grants automatically." />
          : (
            <View style={styles.list}>
              {rewards.map((reward) => (
                <Pressable key={reward.id} accessibilityRole="button" accessibilityLabel={`${reward.name}. ${rewardTypeLabel(reward.type)}. ${reward.pointsCost} points. ${reward.active ? 'Active' : 'Inactive'}.`} onPress={() => canManage && open(reward)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
                  <View style={styles.cardTop}>
                    <View style={styles.icon}><Ionicons name="gift-outline" size={20} color={colors.primary} /></View>
                    <View style={styles.copy}>
                      <Text style={styles.name}>{reward.name}</Text>
                      <Text style={styles.detail}>{rewardValueSummary(reward, currency)} · {reward.pointsCost === 0 ? 'no points' : `${reward.pointsCost} pts`}</Text>
                    </View>
                    <StatusBadge label={reward.active ? 'Active' : 'Inactive'} />
                  </View>
                  {reward.description ? <Text style={styles.description}>{reward.description}</Text> : null}
                  <Text style={styles.meta}>
                    {[reward.membersOnly ? 'Members only' : null, reward.minTierKey ? `${reward.minTierKey} tier+` : null, reward.type === 'milestone' && reward.milestoneBookings ? `${reward.milestoneBookings} bookings` : null, reward.redemptionValidityDays ? `valid ${reward.redemptionValidityDays}d` : null, reward.endsAt ? `ends ${formatDate(reward.endsAt)}` : null].filter(Boolean).join(' · ') || 'Available to every member'}
                  </Text>
                  {canManage ? <View style={styles.actions}><SecondaryButton compact label="Edit" onPress={() => open(reward)} /><SecondaryButton compact label={reward.active ? 'Deactivate' : 'Reactivate'} onPress={() => toggleActive(reward)} /></View> : null}
                </Pressable>
              ))}
            </View>
          )}
        {canManage && loaded && !error ? <PrimaryButton fullWidth icon="add" label="Add reward" onPress={() => open()} /> : null}
      </Screen>

      <FormModal
        visible={Boolean(editing)}
        title={editing === 'new' ? 'New reward' : 'Edit reward'}
        busy={saving}
        submitLabel={editing === 'new' ? 'Create reward' : 'Save reward'}
        onClose={() => setEditing(null)}
        onSubmit={() => void submit()}
      >
        <TextField label="Reward name" value={draft.name} onChangeText={(v) => set('name', v)} placeholder="e.g. Free wash" />
        <TextField label="Description (optional)" value={draft.description} onChangeText={(v) => set('description', v)} multiline />
        <Segmented label="Reward type" options={TYPES} value={draft.type} onChange={(v) => set('type', v)} renderLabel={rewardTypeLabel} />
        {draft.type === 'percent_discount' ? <NumberField label="Discount %" value={draft.value} onChangeText={(v) => set('value', v)} placeholder="20" />
          : draft.type === 'fixed_discount' ? <NumberField label={`Amount off (${currency})`} value={draft.value} onChangeText={(v) => set('value', v)} placeholder="10" />
          : null}
        {draft.type === 'milestone' ? (
          <NumberField label="Completed bookings to unlock" value={draft.milestoneBookings} onChangeText={(v) => set('milestoneBookings', v)} placeholder="10" hint="Granted automatically when the customer reaches this many completed bookings." />
        ) : (
          <NumberField label="Points to redeem" value={draft.pointsCost} onChangeText={(v) => set('pointsCost', v)} placeholder="500" />
        )}
        <TextField label="Minimum tier key (optional)" value={draft.minTierKey} onChangeText={(v) => set('minTierKey', v)} placeholder="silver" />
        <NumberField label="Redemption valid for (days, optional)" value={draft.redemptionValidityDays} onChangeText={(v) => set('redemptionValidityDays', v)} placeholder="30" />
        {draft.type !== 'milestone' ? <SwitchRow label="Members only" detail="Only customers with an active membership can redeem this." value={draft.membersOnly} onValueChange={(v) => set('membersOnly', v)} /> : null}
        <FormError message={formError} />
      </FormModal>
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  copy: { flex: 1, minWidth: 0 },
  name: { ...typography.bodyStrong, color: colors.text },
  detail: { ...typography.caption, color: colors.textSecondary },
  description: { ...typography.body, color: colors.text },
  meta: { ...typography.caption, color: colors.textSecondary },
  actions: { flexDirection: 'row', gap: spacing.xs },
  pressed: { opacity: 0.72 },
});
