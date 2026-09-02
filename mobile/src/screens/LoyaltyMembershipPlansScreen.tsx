import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader, EmptyState, ErrorState, LoadingState, PrimaryButton, Screen, SecondaryButton, StatusBadge } from '../components/ui';
import { FormError, FormModal, NumberField, Segmented, SwitchRow, TextField } from '../components/loyaltyForms';
import { BusinessMembershipPlanDto, BusinessMembershipPlanInput, MembershipBillingInterval } from '../apiTypes';
import { ApiError } from '../services/api';
import { businessLoyaltyApi } from '../services/businessLoyalty';
import { billingIntervalLabel, MEMBERSHIP_NO_PAYMENT_NOTE, PlanFormDraft, validatePlanDraft } from '../domain/loyaltyBusiness';
import { useAuth } from '../state/AuthContext';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatMoney } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'LoyaltyMembershipPlans'>;

const INTERVALS: readonly MembershipBillingInterval[] = ['monthly', 'annual', 'unlimited'];
const blank: PlanFormDraft = { name: '', description: '', billingInterval: 'monthly', priceAmount: '', priorityBooking: false, discountPercent: '0' };
const toDraft = (plan: BusinessMembershipPlanDto): PlanFormDraft => ({
  name: plan.name, description: plan.description ?? '', billingInterval: plan.billingInterval,
  priceAmount: String(plan.priceAmount), priorityBooking: plan.priorityBooking, discountPercent: String(plan.discountPercent),
});

export function LoyaltyMembershipPlansScreen(_props: Props) {
  const { role, business } = useAuth();
  const canManage = role === 'OWNER' || role === 'ADMIN';
  const currency = business?.currency ?? 'USD';
  const [plans, setPlans] = useState<BusinessMembershipPlanDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BusinessMembershipPlanDto | 'new' | null>(null);
  const [draft, setDraft] = useState<PlanFormDraft>(blank);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setPlans(await businessLoyaltyApi.listMembershipPlans()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load membership plans.'); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = (plan?: BusinessMembershipPlanDto) => { setDraft(plan ? toDraft(plan) : blank); setEditing(plan ?? 'new'); setFormError(null); };
  const set = <K extends keyof PlanFormDraft>(key: K, value: PlanFormDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (saving || !editing) return;
    const check = validatePlanDraft(draft);
    if (!check.ok) { setFormError(check.error); return; }
    setSaving(true); setFormError(null);
    const body: BusinessMembershipPlanInput = {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      billingInterval: draft.billingInterval,
      priceAmount: Number(draft.priceAmount || '0'),
      priorityBooking: draft.priorityBooking,
      discountPercent: Number(draft.discountPercent || '0'),
    };
    try {
      if (editing === 'new') await businessLoyaltyApi.createMembershipPlan(body);
      else await businessLoyaltyApi.updateMembershipPlan(editing.id, body);
      setEditing(null);
      await load();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Could not save this plan.');
    } finally { setSaving(false); }
  };

  const toggleActive = (plan: BusinessMembershipPlanDto) => {
    const next = !plan.active;
    Alert.alert(next ? 'Reactivate this plan?' : 'Deactivate this plan?', next ? 'Customers will be able to join it again.' : 'Customers can no longer join. Current members keep their membership.', [
      { text: 'Cancel', style: 'cancel' },
      { text: next ? 'Reactivate' : 'Deactivate', style: next ? 'default' : 'destructive', onPress: () => void (next ? businessLoyaltyApi.updateMembershipPlan(plan.id, { active: true }) : businessLoyaltyApi.deleteMembershipPlan(plan.id)).then(load).catch(() => Alert.alert('Could not update plan', 'Please try again.')) },
    ]);
  };

  return (
    <>
      <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
        <AppHeader eyebrow="LOYALTY & REWARDS" title="Membership plans" subtitle="Member pricing and priority booking for your regulars." />
        <View style={styles.note}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.noteText}>{MEMBERSHIP_NO_PAYMENT_NOTE}</Text>
        </View>
        {!loaded ? <LoadingState label="Loading plans…" />
          : error && !plans.length ? <ErrorState message={error} onRetry={() => void load()} />
          : !plans.length ? <EmptyState icon="card-outline" title="No membership plans" message="Create a plan to give members a discount on every booking, priority slots, or both. No payment is taken here — this configures the entitlement." />
          : (
            <View style={styles.list}>
              {plans.map((plan) => (
                <Pressable key={plan.id} accessibilityRole="button" accessibilityLabel={`${plan.name}. ${billingIntervalLabel(plan.billingInterval)}. ${plan.discountPercent}% member discount. ${plan.active ? 'Active' : 'Inactive'}.`} onPress={() => canManage && open(plan)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
                  <View style={styles.cardTop}>
                    <View style={styles.icon}><Ionicons name="card-outline" size={20} color={colors.primary} /></View>
                    <View style={styles.copy}>
                      <Text style={styles.name}>{plan.name}</Text>
                      <Text style={styles.detail}>{formatMoney(plan.priceAmount, plan.currency ?? currency)} · {billingIntervalLabel(plan.billingInterval)}</Text>
                    </View>
                    <StatusBadge label={plan.active ? 'Active' : 'Inactive'} />
                  </View>
                  {plan.description ? <Text style={styles.description}>{plan.description}</Text> : null}
                  <Text style={styles.meta}>{[plan.discountPercent > 0 ? `${plan.discountPercent}% off bookings` : null, plan.priorityBooking ? 'Priority booking' : null].filter(Boolean).join(' · ') || 'No member perks configured'}</Text>
                  {canManage ? <View style={styles.actions}><SecondaryButton compact label="Edit" onPress={() => open(plan)} /><SecondaryButton compact label={plan.active ? 'Deactivate' : 'Reactivate'} onPress={() => toggleActive(plan)} /></View> : null}
                </Pressable>
              ))}
            </View>
          )}
        {canManage && loaded && !error ? <PrimaryButton fullWidth icon="add" label="Add plan" onPress={() => open()} /> : null}
      </Screen>

      <FormModal visible={Boolean(editing)} title={editing === 'new' ? 'New membership plan' : 'Edit plan'} busy={saving} submitLabel={editing === 'new' ? 'Create plan' : 'Save plan'} onClose={() => setEditing(null)} onSubmit={() => void submit()}>
        <TextField label="Plan name" value={draft.name} onChangeText={(v) => set('name', v)} placeholder="e.g. Gold membership" />
        <TextField label="Description (optional)" value={draft.description} onChangeText={(v) => set('description', v)} multiline />
        <Segmented label="Billing interval" options={INTERVALS} value={draft.billingInterval} onChange={(v) => set('billingInterval', v)} renderLabel={billingIntervalLabel} />
        <NumberField label={`Price shown to customers (${currency})`} value={draft.priceAmount} onChangeText={(v) => set('priceAmount', v)} placeholder="20" hint="Displayed only. Chakusa does not charge this." />
        <NumberField label="Member discount on bookings (%)" value={draft.discountPercent} onChangeText={(v) => set('discountPercent', v)} placeholder="0" />
        <SwitchRow label="Priority booking" detail="Members are flagged for priority when booking." value={draft.priorityBooking} onValueChange={(v) => set('priorityBooking', v)} />
        <FormError message={formError} />
      </FormModal>
    </>
  );
}

const styles = StyleSheet.create({
  note: { flexDirection: 'row', gap: spacing.xs, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.primarySoft },
  noteText: { flex: 1, ...typography.caption, color: colors.textSecondary },
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
