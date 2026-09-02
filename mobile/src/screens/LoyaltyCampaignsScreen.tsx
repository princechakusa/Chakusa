import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppHeader, EmptyState, ErrorState, LoadingState, PrimaryButton, Screen, SecondaryButton, StatusBadge } from '../components/ui';
import { FormError, FormModal, NumberField, Segmented, TextField } from '../components/loyaltyForms';
import { LoyaltyCampaignDto, LoyaltyCampaignInput, LoyaltyCampaignKind } from '../apiTypes';
import { ApiError } from '../services/api';
import { businessLoyaltyApi } from '../services/businessLoyalty';
import { CampaignFormDraft, campaignKindLabel, campaignWindowLabel, validateCampaignDraft } from '../domain/loyaltyBusiness';
import { useAuth } from '../state/AuthContext';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDate } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'LoyaltyCampaigns'>;

const KINDS: readonly LoyaltyCampaignKind[] = ['multiplier', 'bonus_points'];
const isoDay = (offsetDays: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString(); };
const blank = (): CampaignFormDraft => ({ name: '', description: '', kind: 'multiplier', multiplier: '2', bonusPoints: '0', startsAt: isoDay(0), endsAt: isoDay(7) });
const toDraft = (c: LoyaltyCampaignDto): CampaignFormDraft => ({ name: c.name, description: c.description ?? '', kind: (c.kind === 'bonus_points' ? 'bonus_points' : 'multiplier'), multiplier: String(c.multiplier), bonusPoints: String(c.bonusPoints), startsAt: c.startsAt, endsAt: c.endsAt });

export function LoyaltyCampaignsScreen(_props: Props) {
  const { role } = useAuth();
  const canManage = role === 'OWNER' || role === 'ADMIN';
  const [campaigns, setCampaigns] = useState<LoyaltyCampaignDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<LoyaltyCampaignDto | 'new' | null>(null);
  const [draft, setDraft] = useState<CampaignFormDraft>(blank());
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setCampaigns(await businessLoyaltyApi.listCampaigns()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load campaigns.'); }
    finally { setLoaded(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = (campaign?: LoyaltyCampaignDto) => { setDraft(campaign ? toDraft(campaign) : blank()); setEditing(campaign ?? 'new'); setFormError(null); };
  const set = <K extends keyof CampaignFormDraft>(key: K, value: CampaignFormDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const shiftDate = (key: 'startsAt' | 'endsAt', days: number) => set(key, (() => { const d = new Date(draft[key]); d.setUTCDate(d.getUTCDate() + days); return d.toISOString(); })());

  const submit = async () => {
    if (saving || !editing) return;
    const check = validateCampaignDraft(draft);
    if (!check.ok) { setFormError(check.error); return; }
    setSaving(true); setFormError(null);
    const body: LoyaltyCampaignInput = {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      kind: draft.kind,
      multiplier: draft.kind === 'multiplier' ? Number(draft.multiplier) : undefined,
      bonusPoints: draft.kind === 'bonus_points' ? Number(draft.bonusPoints) : undefined,
      startsAt: draft.startsAt,
      endsAt: draft.endsAt,
    };
    try {
      if (editing === 'new') await businessLoyaltyApi.createCampaign(body);
      else await businessLoyaltyApi.updateCampaign(editing.id, body);
      setEditing(null);
      await load();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Could not save this campaign.');
    } finally { setSaving(false); }
  };

  const toggleActive = (campaign: LoyaltyCampaignDto) => {
    const next = !campaign.active;
    Alert.alert(next ? 'Turn this campaign on?' : 'Turn this campaign off?', next ? 'Bonus points apply during its date window.' : 'No bonus points will be applied.', [
      { text: 'Cancel', style: 'cancel' },
      { text: next ? 'Turn on' : 'Turn off', style: next ? 'default' : 'destructive', onPress: () => void businessLoyaltyApi.updateCampaign(campaign.id, { active: next }).then(load).catch(() => Alert.alert('Could not update campaign', 'Please try again.')) },
    ]);
  };

  return (
    <>
      <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
        <AppHeader eyebrow="LOYALTY & REWARDS" title="Campaigns" subtitle="Time-boxed boosts to points earned on bookings and reviews." />
        {!loaded ? <LoadingState label="Loading campaigns…" />
          : error && !campaigns.length ? <ErrorState message={error} onRetry={() => void load()} />
          : !campaigns.length ? <EmptyState icon="flash-outline" title="No campaigns" message="Run a limited-time double-points week or a fixed bonus on every completed booking." />
          : (
            <View style={styles.list}>
              {campaigns.map((campaign) => (
                <Pressable key={campaign.id} accessibilityRole="button" accessibilityLabel={`${campaign.name}. ${campaignKindLabel(campaign.kind)}. ${campaignWindowLabel(campaign)}.`} onPress={() => canManage && open(campaign)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
                  <View style={styles.cardTop}>
                    <View style={styles.icon}><Ionicons name="flash-outline" size={20} color={colors.primary} /></View>
                    <View style={styles.copy}>
                      <Text style={styles.name}>{campaign.name}</Text>
                      <Text style={styles.detail}>{campaign.kind === 'multiplier' ? `${campaign.multiplier}× points` : `+${campaign.bonusPoints} points`} · {formatDate(campaign.startsAt)} – {formatDate(campaign.endsAt)}</Text>
                    </View>
                    <StatusBadge label={campaignWindowLabel(campaign)} />
                  </View>
                  {campaign.description ? <Text style={styles.description}>{campaign.description}</Text> : null}
                  {canManage ? <View style={styles.actions}><SecondaryButton compact label="Edit" onPress={() => open(campaign)} /><SecondaryButton compact label={campaign.active ? 'Turn off' : 'Turn on'} onPress={() => toggleActive(campaign)} /></View> : null}
                </Pressable>
              ))}
            </View>
          )}
        {canManage && loaded && !error ? <PrimaryButton fullWidth icon="add" label="Add campaign" onPress={() => open()} /> : null}
      </Screen>

      <FormModal visible={Boolean(editing)} title={editing === 'new' ? 'New campaign' : 'Edit campaign'} busy={saving} submitLabel={editing === 'new' ? 'Create campaign' : 'Save campaign'} onClose={() => setEditing(null)} onSubmit={() => void submit()}>
        <TextField label="Campaign name" value={draft.name} onChangeText={(v) => set('name', v)} placeholder="e.g. Double points week" />
        <TextField label="Description (optional)" value={draft.description} onChangeText={(v) => set('description', v)} multiline />
        <Segmented label="Boost type" options={KINDS} value={draft.kind} onChange={(v) => set('kind', v)} renderLabel={campaignKindLabel} />
        {draft.kind === 'multiplier'
          ? <NumberField label="Points multiplier (1–20)" value={draft.multiplier} onChangeText={(v) => set('multiplier', v)} placeholder="2" />
          : <NumberField label="Bonus points per event" value={draft.bonusPoints} onChangeText={(v) => set('bonusPoints', v)} placeholder="50" />}
        <DateStepper label="Starts" value={draft.startsAt} onShift={(days) => shiftDate('startsAt', days)} />
        <DateStepper label="Ends" value={draft.endsAt} onShift={(days) => shiftDate('endsAt', days)} />
        <FormError message={formError} />
      </FormModal>
    </>
  );
}

function DateStepper({ label, value, onShift }: { label: string; value: string; onShift: (days: number) => void }) {
  return (
    <View style={styles.stepper}>
      <View style={styles.stepperCopy}>
        <Text style={styles.stepperLabel}>{label}</Text>
        <Text style={styles.stepperValue}>{formatDate(value, { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
      </View>
      <View style={styles.stepperButtons}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} one day earlier`} onPress={() => onShift(-1)} style={styles.stepperButton}><Ionicons name="remove" size={18} color={colors.text} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} one week later`} onPress={() => onShift(7)} style={styles.stepperButton}><Text style={styles.stepperWeek}>+1w</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} one day later`} onPress={() => onShift(1)} style={styles.stepperButton}><Ionicons name="add" size={18} color={colors.text} /></Pressable>
      </View>
    </View>
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
  actions: { flexDirection: 'row', gap: spacing.xs },
  pressed: { opacity: 0.72 },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 },
  stepperCopy: { gap: 2 },
  stepperLabel: { ...typography.caption, color: colors.text },
  stepperValue: { ...typography.bodyStrong, color: colors.text },
  stepperButtons: { flexDirection: 'row', gap: spacing.xs },
  stepperButton: { minWidth: 44, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  stepperWeek: { ...typography.caption, color: colors.text, fontWeight: '700' },
});
