import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { AppHeader, ErrorState, LoadingState, PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { FieldLabel, FormError, NumberField } from '../components/loyaltyForms';
import { LoyaltyProgramDto } from '../apiTypes';
import { ApiError } from '../services/api';
import { businessLoyaltyApi } from '../services/businessLoyalty';
import { ProgramFormDraft, TierDraft, validateProgramDraft, validateTiers } from '../domain/loyaltyBusiness';
import { useAuth } from '../state/AuthContext';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'LoyaltyProgramSettings'>;

const toDraft = (program: LoyaltyProgramDto | null): ProgramFormDraft => ({
  active: program?.active ?? false,
  pointsPerCurrency: String(program?.pointsPerCurrency ?? 1),
  pointsPerBookingBonus: String(program?.pointsPerBookingBonus ?? 0),
  pointsPerReview: String(program?.pointsPerReview ?? 0),
  pointsPerReferral: String(program?.pointsPerReferral ?? 0),
  pointExpiryDays: program?.pointExpiryDays == null ? '' : String(program.pointExpiryDays),
  welcomeBonus: String(program?.welcomeBonus ?? 0),
});

const toTierDrafts = (program: LoyaltyProgramDto | null): TierDraft[] =>
  (program?.tierConfig ?? []).map((tier) => ({ key: tier.key, name: tier.name, minPoints: String(tier.minPoints ?? 0) }));

export function LoyaltyProgramSettingsScreen({ navigation }: Props) {
  const { role } = useAuth();
  const canManage = role === 'OWNER' || role === 'ADMIN';
  const [draft, setDraft] = useState<ProgramFormDraft>(toDraft(null));
  const [tiers, setTiers] = useState<TierDraft[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const program = await businessLoyaltyApi.getProgram();
      setDraft(toDraft(program.configured === false ? null : program));
      setTiers(toTierDrafts(program));
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught instanceof ApiError ? caught.message : 'Could not load your program.');
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const field = (key: keyof ProgramFormDraft) => (value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const programCheck = useMemo(() => validateProgramDraft(draft), [draft]);
  const tierCheck = useMemo(() => validateTiers(tiers), [tiers]);

  const save = async () => {
    if (!canManage || saving) return;
    if (!programCheck.ok) { setSaveError('Fix the highlighted fields first.'); return; }
    if (!tierCheck.ok) { setSaveError(tierCheck.error); return; }
    setSaving(true);
    setSaveError(null);
    try {
      await businessLoyaltyApi.saveProgram({ ...programCheck.input!, tierConfig: tierCheck.tiers ?? [] });
      navigation.goBack();
    } catch (caught) {
      setSaveError(caught instanceof ApiError ? caught.message : 'Could not save your program.');
    } finally {
      setSaving(false);
    }
  };

  const setTier = (index: number, patch: Partial<TierDraft>) =>
    setTiers((current) => current.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));
  const addTier = () => setTiers((current) => [...current, { key: '', name: '', minPoints: current.length ? '' : '0' }]);
  const removeTier = (index: number) => setTiers((current) => current.filter((_, i) => i !== index));

  if (!loaded) return <Screen><AppHeader eyebrow="LOYALTY & REWARDS" title="Program settings" /><LoadingState label="Loading…" /></Screen>;
  if (loadError) return <Screen><AppHeader eyebrow="LOYALTY & REWARDS" title="Program settings" /><ErrorState message={loadError} onRetry={() => void load()} /></Screen>;

  return (
    <Screen>
      <AppHeader eyebrow="LOYALTY & REWARDS" title="Program settings" subtitle="Point values apply to completed bookings, reviews and referrals through the existing backend hooks." />

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.switchCopy}>
            <Text style={styles.switchLabel}>Loyalty program active</Text>
            <Text style={styles.hint}>Customers earn and redeem points only while this is on.</Text>
          </View>
          <Switch accessibilityLabel="Loyalty program active" value={draft.active} onValueChange={(active) => setDraft((c) => ({ ...c, active }))} disabled={!canManage} trackColor={{ false: colors.border, true: colors.success }} thumbColor={colors.surface} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Earning</Text>
        <NumberField label="Points per unit of currency spent" value={draft.pointsPerCurrency} onChangeText={field('pointsPerCurrency')} hint={programCheck.errors.pointsPerCurrency ?? 'e.g. 10 gives 300 points for a 30.00 booking'} />
        <NumberField label="Bonus points per completed booking" value={draft.pointsPerBookingBonus} onChangeText={field('pointsPerBookingBonus')} hint={programCheck.errors.pointsPerBookingBonus ?? undefined} />
        <NumberField label="Points per review" value={draft.pointsPerReview} onChangeText={field('pointsPerReview')} hint={programCheck.errors.pointsPerReview ?? 'Awarded for any submitted review — never gated on rating'} />
        <NumberField label="Points per completed referral" value={draft.pointsPerReferral} onChangeText={field('pointsPerReferral')} hint={programCheck.errors.pointsPerReferral ?? undefined} />
        <NumberField label="Welcome bonus on joining" value={draft.welcomeBonus} onChangeText={field('welcomeBonus')} hint={programCheck.errors.welcomeBonus ?? undefined} />
        <NumberField label="Points expire after (days)" value={draft.pointExpiryDays} onChangeText={field('pointExpiryDays')} placeholder="Never" hint={programCheck.errors.pointExpiryDays ?? 'Leave blank for points that never expire'} />
      </View>

      <View style={styles.card}>
        <View style={styles.tierHeader}>
          <Text style={styles.cardTitle}>Tiers</Text>
          {canManage ? <Pressable accessibilityRole="button" accessibilityLabel="Add tier" onPress={addTier} hitSlop={8}><Text style={styles.addTier}>Add tier</Text></Pressable> : null}
        </View>
        <Text style={styles.hint}>Leave empty to use the standard Bronze / Silver / Gold / Platinum tiers. The first tier must start at 0.</Text>
        {tiers.map((tier, index) => (
          <View key={index} style={styles.tierRow}>
            <View style={styles.tierName}>
              <FieldLabel>Name</FieldLabel>
              <TextInput accessibilityLabel={`Tier ${index + 1} name`} value={tier.name} onChangeText={(name) => setTier(index, { name, key: tier.key || name })} style={styles.input} placeholder="Silver" placeholderTextColor={colors.textSecondary} />
            </View>
            <View style={styles.tierPoints}>
              <FieldLabel>Min points</FieldLabel>
              <TextInput accessibilityLabel={`Tier ${index + 1} minimum points`} keyboardType="number-pad" value={tier.minPoints} onChangeText={(minPoints) => setTier(index, { minPoints })} style={styles.input} />
            </View>
            {canManage ? <Pressable accessibilityRole="button" accessibilityLabel={`Remove tier ${index + 1}`} onPress={() => removeTier(index)} style={styles.removeTier} hitSlop={8}><Ionicons name="close-circle" size={22} color={colors.tabInactive} /></Pressable> : null}
          </View>
        ))}
        {!tierCheck.ok ? <Text style={styles.error}>{tierCheck.error}</Text> : null}
      </View>

      <FormError message={saveError} />
      {canManage ? (
        <PrimaryButton fullWidth disabled={saving} label={saving ? 'Saving…' : 'Save program'} onPress={() => void save()} />
      ) : (
        <Text style={styles.hint}>Only owners and admins can change loyalty settings.</Text>
      )}
      <SecondaryButton fullWidth disabled={saving} label="Cancel" onPress={() => (canManage ? Alert.alert('Discard changes?', 'Your edits will not be saved.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() }]) : navigation.goBack())} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md, gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, ...shadows.card },
  cardTitle: { ...typography.subheading, color: colors.text },
  hint: { ...typography.caption, color: colors.textSecondary },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 52 },
  switchCopy: { flex: 1, minWidth: 0, gap: 2 },
  switchLabel: { ...typography.bodyStrong, color: colors.text },
  tierHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addTier: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  tierRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  tierName: { flex: 1, gap: spacing.xs },
  tierPoints: { width: 110, gap: spacing.xs },
  removeTier: { paddingBottom: spacing.xs },
  input: { minHeight: 46, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, ...typography.body, color: colors.text },
  error: { ...typography.caption, color: colors.negative },
});
