import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { LoyaltyProgramDto } from '../apiTypes';
import { ApiError } from '../services/api';
import { businessLoyaltyApi } from '../services/businessLoyalty';
import { ProgramFormDraft, TierDraft, validateProgramDraft, validateTiers } from '../domain/loyaltyBusiness';
import { useAuth } from '../state/AuthContext';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Icon, M3Card, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
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

  const header = (
    <M3Header businessName="Program settings" onBack={() => navigation.goBack()} hasNotifications={false} />
  );

  if (!loaded) {
    return (
      <M3Screen header={header} scroll={false}>
        <M3Loading label="Loading…" />
      </M3Screen>
    );
  }
  if (loadError) {
    return (
      <M3Screen header={header} scroll={false}>
        <M3Error message={loadError} onRetry={() => void load()} />
      </M3Screen>
    );
  }

  return (
    <M3Screen header={header} scroll={false}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Program settings</Text>
            <Text style={styles.subtitle}>Point values apply to completed bookings, reviews and referrals through the existing backend hooks.</Text>
          </View>

          <M3Card style={styles.card}>
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Text style={styles.switchLabel}>Loyalty program active</Text>
                <Text style={styles.hint}>Customers earn and redeem points only while this is on.</Text>
              </View>
              <Switch
                accessibilityLabel="Loyalty program active"
                value={draft.active}
                onValueChange={(active) => setDraft((c) => ({ ...c, active }))}
                disabled={!canManage}
                trackColor={{ false: m3.outlineVariant, true: m3.secondary }}
                thumbColor={m3.surfaceContainerLowest}
              />
            </View>
          </M3Card>

          <M3Card style={styles.card}>
            <Text style={styles.cardTitle}>Earning</Text>
            <Field label="Points per unit of currency spent" value={draft.pointsPerCurrency} onChangeText={field('pointsPerCurrency')} hint={programCheck.errors.pointsPerCurrency ?? 'e.g. 10 gives 300 points for a 30.00 booking'} />
            <Field label="Bonus points per completed booking" value={draft.pointsPerBookingBonus} onChangeText={field('pointsPerBookingBonus')} hint={programCheck.errors.pointsPerBookingBonus ?? undefined} />
            <Field label="Points per review" value={draft.pointsPerReview} onChangeText={field('pointsPerReview')} hint={programCheck.errors.pointsPerReview ?? 'Awarded for any submitted review - never gated on rating'} />
            <Field label="Points per completed referral" value={draft.pointsPerReferral} onChangeText={field('pointsPerReferral')} hint={programCheck.errors.pointsPerReferral ?? undefined} />
            <Field label="Welcome bonus on joining" value={draft.welcomeBonus} onChangeText={field('welcomeBonus')} hint={programCheck.errors.welcomeBonus ?? undefined} />
            <Field label="Points expire after (days)" value={draft.pointExpiryDays} onChangeText={field('pointExpiryDays')} placeholder="Never" hint={programCheck.errors.pointExpiryDays ?? 'Leave blank for points that never expire'} />
          </M3Card>

          <M3Card style={styles.card}>
            <View style={styles.tierHeader}>
              <Text style={styles.cardTitle}>Tiers</Text>
              {canManage ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Add tier" onPress={addTier} hitSlop={8} style={styles.addTierBtn}>
                  <Icon name="add" size={14} color={m3.primary} />
                  <Text style={styles.addTier}>Add tier</Text>
                </Pressable>
              ) : null}
            </View>
            <Text style={styles.hint}>Leave empty to use the standard Bronze / Silver / Gold / Platinum tiers. The first tier must start at 0.</Text>
            {tiers.map((tier, index) => (
              <View key={index} style={styles.tierRow}>
                <View style={styles.tierName}>
                  <Text style={styles.label}>Name</Text>
                  <TextInput accessibilityLabel={`Tier ${index + 1} name`} value={tier.name} onChangeText={(name) => setTier(index, { name, key: tier.key || name })} style={styles.input} placeholder="Silver" placeholderTextColor={m3.outline} />
                </View>
                <View style={styles.tierPoints}>
                  <Text style={styles.label}>Min points</Text>
                  <TextInput accessibilityLabel={`Tier ${index + 1} minimum points`} keyboardType="number-pad" value={tier.minPoints} onChangeText={(minPoints) => setTier(index, { minPoints })} style={styles.input} />
                </View>
                {canManage ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={`Remove tier ${index + 1}`} onPress={() => removeTier(index)} style={styles.removeTier} hitSlop={8}>
                    <Icon name="cancel" size={22} color={m3.onSurfaceVariant} />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {!tierCheck.ok ? <Text style={styles.error}>{tierCheck.error}</Text> : null}
          </M3Card>

          {saveError ? <Text accessibilityRole="alert" style={styles.error}>{saveError}</Text> : null}
          {canManage ? (
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => void save()} style={[styles.primaryBtn, saving && styles.disabled]}>
              <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : 'Save program'}</Text>
            </Pressable>
          ) : (
            <Text style={styles.hint}>Only owners and admins can change loyalty settings.</Text>
          )}
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() =>
              canManage
                ? Alert.alert('Discard changes?', 'Your edits will not be saved.', [
                    { text: 'Keep editing', style: 'cancel' },
                    { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
                  ])
                : navigation.goBack()
            }
            style={[styles.secondaryBtn, saving && styles.disabled]}
          >
            <Text style={styles.secondaryBtnText}>Cancel</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </M3Screen>
  );
}

function Field({ label, hint, ...props }: { label: string; value: string; onChangeText: (value: string) => void; placeholder?: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} keyboardType="number-pad" placeholderTextColor={m3.outline} {...props} style={styles.input} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { paddingHorizontal: m3Space.md, paddingTop: m3Space.sm, paddingBottom: m3Space.xxl, gap: m3Space.md },

  titleBlock: { gap: 2 },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },

  card: { gap: m3Space.sm },
  cardTitle: { ...m3Type.titleMd, color: m3.onSurface },
  hint: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, minHeight: 52 },
  switchLabel: { ...m3Type.labelLg, color: m3.onSurface },

  field: { gap: 6 },
  label: { ...m3Type.labelMd, color: m3.onSurface },
  input: { minHeight: 46, paddingHorizontal: m3Space.sm, borderRadius: m3Radius.md, borderWidth: 1, borderColor: m3.outlineVariant, backgroundColor: m3.surfaceContainerLowest, ...m3Type.bodyMd, color: m3.onSurface },

  tierHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addTierBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  addTier: { ...m3Type.labelMd, color: m3.primary },
  tierRow: { flexDirection: 'row', alignItems: 'flex-end', gap: m3Space.xs },
  tierName: { flex: 1, gap: 6 },
  tierPoints: { width: 110, gap: 6 },
  removeTier: { paddingBottom: 10 },
  error: { ...m3Type.bodySm, color: m3.error },

  primaryBtn: { height: 48, borderRadius: m3Radius.md, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { ...m3Type.labelLg, color: m3.onPrimary },
  secondaryBtn: { height: 46, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { ...m3Type.labelLg, color: m3.onSurface },
  disabled: { opacity: 0.6 },
});
