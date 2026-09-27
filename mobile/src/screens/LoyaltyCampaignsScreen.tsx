import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { FormError, FormModal, NumberField, Segmented, TextField } from '../components/loyaltyForms';
import { LoyaltyCampaignDto, LoyaltyCampaignInput, LoyaltyCampaignKind } from '../apiTypes';
import { ApiError } from '../services/api';
import { businessLoyaltyApi } from '../services/businessLoyalty';
import { CampaignFormDraft, campaignKindLabel, campaignWindowLabel, validateCampaignDraft } from '../domain/loyaltyBusiness';
import { useAuth } from '../state/AuthContext';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { RootStackParamList } from '../types';
import { formatDate } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'LoyaltyCampaigns'>;

const KINDS: readonly LoyaltyCampaignKind[] = ['multiplier', 'bonus_points'];
const isoDay = (offsetDays: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString(); };
const blank = (): CampaignFormDraft => ({ name: '', description: '', kind: 'multiplier', multiplier: '2', bonusPoints: '0', startsAt: isoDay(0), endsAt: isoDay(7) });
const toDraft = (c: LoyaltyCampaignDto): CampaignFormDraft => ({ name: c.name, description: c.description ?? '', kind: (c.kind === 'bonus_points' ? 'bonus_points' : 'multiplier'), multiplier: String(c.multiplier), bonusPoints: String(c.bonusPoints), startsAt: c.startsAt, endsAt: c.endsAt });

const STATUS_FILTERS = ['all', 'live', 'scheduled', 'ended'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function statusFilterFor(campaign: LoyaltyCampaignDto): StatusFilter {
  const label = campaignWindowLabel(campaign).toLowerCase();
  if (!campaign.active) return 'ended';
  if (label.includes('live') || label.includes('active')) return 'live';
  if (label.includes('upcoming') || label.includes('scheduled')) return 'scheduled';
  return 'ended';
}

export function LoyaltyCampaignsScreen({ navigation }: Props) {
  const { role } = useAuth();
  const canManage = role === 'OWNER' || role === 'ADMIN';
  const [campaigns, setCampaigns] = useState<LoyaltyCampaignDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
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

  const visible = campaigns.filter((c) => filter === 'all' || statusFilterFor(c) === filter);
  const header = <M3Header businessName="Campaigns" onBack={() => navigation.goBack()} hasNotifications={false} />;

  return (
    <>
      <M3Screen header={header} refreshControl={undefined}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <Text style={styles.title}>Loyalty Campaigns</Text>
            <Text style={styles.subtitle}>Time-boxed boosts to points earned on bookings and reviews.</Text>
          </View>
          {canManage ? (
            <Pressable accessibilityRole="button" onPress={() => open()} style={styles.addBtn}>
              <Icon name="add" size={18} color={m3.onPrimary} />
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.chipsWrap}>
          {STATUS_FILTERS.map((f) => (
            <Chip
              key={f}
              label={f === 'all' ? 'All' : f[0].toUpperCase() + f.slice(1)}
              selected={filter === f}
              count={f === 'all' ? campaigns.length : campaigns.filter((c) => statusFilterFor(c) === f).length}
              onPress={() => setFilter(f)}
            />
          ))}
        </View>

        {!loaded ? (
          <M3Loading label="Loading campaigns…" />
        ) : error && !campaigns.length ? (
          <M3Error message={error} onRetry={() => void load()} />
        ) : !visible.length ? (
          <M3Empty icon="bolt" title="No campaigns" message="Run a limited-time double-points week or a fixed bonus on every completed booking." />
        ) : (
          <View style={styles.list}>
            {visible.map((campaign) => (
              <M3Card key={campaign.id} onPress={() => canManage && open(campaign)} style={styles.card}>
                <View style={styles.cardTop}>
                  <View style={styles.icon}>
                    <Icon name="bolt" size={20} color={m3.primary} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.name}>{campaign.name}</Text>
                    <Text style={styles.detail}>
                      {campaign.kind === 'multiplier' ? `${campaign.multiplier}× points` : `+${campaign.bonusPoints} points`} · {formatDate(campaign.startsAt)} - {formatDate(campaign.endsAt)}
                    </Text>
                  </View>
                  <Chip label={campaignWindowLabel(campaign)} tone={campaign.active ? 'secondary' : 'neutral'} />
                </View>
                {campaign.description ? <Text style={styles.description}>{campaign.description}</Text> : null}
                {canManage ? (
                  <View style={styles.actions}>
                    <Pressable accessibilityRole="button" onPress={() => open(campaign)} style={styles.ghostBtn}>
                      <Text style={styles.ghostBtnText}>Edit</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => toggleActive(campaign)} style={styles.ghostBtn}>
                      <Text style={styles.ghostBtnText}>{campaign.active ? 'Turn off' : 'Turn on'}</Text>
                    </Pressable>
                  </View>
                ) : null}
              </M3Card>
            ))}
          </View>
        )}
      </M3Screen>

      <FormModal visible={Boolean(editing)} title={editing === 'new' ? 'New campaign' : 'Edit campaign'} busy={saving} submitLabel={editing === 'new' ? 'Create campaign' : 'Save campaign'} onClose={() => setEditing(null)} onSubmit={() => void submit()}>
        <TextField label="Campaign name" value={draft.name} onChangeText={(v) => set('name', v)} placeholder="e.g. Double points week" />
        <TextField label="Description (optional)" value={draft.description} onChangeText={(v) => set('description', v)} multiline />
        <Segmented label="Boost type" options={KINDS} value={draft.kind} onChange={(v) => set('kind', v)} renderLabel={campaignKindLabel} />
        {draft.kind === 'multiplier'
          ? <NumberField label="Points multiplier (1-20)" value={draft.multiplier} onChangeText={(v) => set('multiplier', v)} placeholder="2" />
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
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} one day earlier`} onPress={() => onShift(-1)} style={styles.stepperButton}><Icon name="remove" size={18} color={m3.onSurface} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} one week later`} onPress={() => onShift(7)} style={styles.stepperButton}><Text style={styles.stepperWeek}>+1w</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label} one day later`} onPress={() => onShift(1)} style={styles.stepperButton}><Icon name="add" size={18} color={m3.onSurface} /></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  list: { gap: m3Space.sm },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 38, paddingHorizontal: 12, borderRadius: m3Radius.sm, backgroundColor: m3.primary },
  addText: { ...m3Type.labelMd, color: m3.onPrimary },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },

  card: { gap: m3Space.sm },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  icon: { width: 42, height: 42, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  name: { ...m3Type.labelLg, color: m3.onSurface },
  detail: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  description: { ...m3Type.bodyMd, color: m3.onSurface },
  actions: { flexDirection: 'row', gap: m3Space.xs },
  ghostBtn: { height: 34, paddingHorizontal: 12, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { ...m3Type.labelMd, color: m3.onSurface },

  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 52 },
  stepperCopy: { gap: 2 },
  stepperLabel: { ...m3Type.labelMd, color: m3.onSurface },
  stepperValue: { ...m3Type.labelLg, color: m3.onSurface },
  stepperButtons: { flexDirection: 'row', gap: m3Space.xs },
  stepperButton: { minWidth: 44, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: m3Radius.md, borderWidth: 1, borderColor: m3.outlineVariant, backgroundColor: m3.surfaceContainerLowest },
  stepperWeek: { ...m3Type.labelMd, color: m3.onSurface },
});
