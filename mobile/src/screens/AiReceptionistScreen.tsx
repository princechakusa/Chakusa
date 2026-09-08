import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Icon, M3Card, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { AiReceptionistViewDto, aiReceptionistApi } from '../services/endpoints';
import { ApiError } from '../services/api';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const POLICY_LABEL: Record<string, string> = {
  AUTONOMOUS: 'Answers and acts automatically',
  DRAFT: 'Drafts replies for a teammate to send',
  APPROVAL: 'Outward actions need teammate sign-off',
  OFF: 'Off',
  SUGGEST: 'Suggests replies only',
};

export function AiReceptionistScreen() {
  const navigation = useNavigation<Nav>();
  const [view, setView] = useState<AiReceptionistViewDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (soft = false) => {
    soft ? setRefreshing(true) : setLoading(true);
    setError(null);
    try { setView(await aiReceptionistApi.get()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to load the AI receptionist.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const patch = async (body: Parameters<typeof aiReceptionistApi.patch>[0]) => {
    if (saving || !view) return;
    setSaving(true);
    const prev = view;
    setView({ ...view, settings: { ...view.settings, ...body } });
    try {
      const next = await aiReceptionistApi.patch(body);
      setView(v => (v ? { ...v, settings: next } : v));
      await load(true);
    } catch (caught) {
      setView(prev);
      setError(caught instanceof ApiError ? caught.message : 'Could not save that change.');
    } finally { setSaving(false); }
  };

  const header = <M3Header businessName="AI receptionist" onBack={() => navigation.goBack()} onNotificationsPress={() => navigation.navigate('AttentionCenter')} hasNotifications={false} />;

  if (loading) return <M3Screen header={header}><M3Loading label="Loading…" /></M3Screen>;
  if (error && !view) return <M3Screen header={header}><M3Error message={error} onRetry={() => void load()} /></M3Screen>;
  if (!view) return <M3Screen header={header}><M3Error message="Not available" /></M3Screen>;

  const { settings, status } = view;
  const disabled = !status.entitled || saving;

  return (
    <M3Screen header={header} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={m3.primary} />}>
      <View style={styles.intro}>
        <Text style={styles.eyebrow}>MESSAGING</Text>
        <Text style={styles.title}>AI receptionist</Text>
        <Text style={styles.sub}>Answers inbound customer texts with your real business info, hours and availability, and can book, reschedule or cancel under your AI policy. A teammate can take over any conversation at any time.</Text>
      </View>

      {!status.entitled ? (
        <M3Card style={styles.card}><Text style={styles.note}>The AI receptionist is part of the Business plan. Upgrade to turn it on.</Text></M3Card>
      ) : null}

      <M3Card style={styles.card}>
        <View style={styles.row}>
          <View style={styles.flex}><Text style={styles.rowTitle}>AI receptionist</Text><Text style={styles.note}>{status.effective ? 'Active — answering inbound messages' : settings.enabled ? 'On, but not currently active' : 'Off'}</Text></View>
          <Switch value={settings.enabled} disabled={disabled} onValueChange={v => void patch({ enabled: v })} trackColor={{ false: m3.surfaceContainerHigh, true: m3.secondary }} />
        </View>
      </M3Card>

      {settings.enabled ? (
        <M3Card style={styles.card}>
          <Text style={styles.sectionLabel}>WHEN IT ANSWERS</Text>
          <ModeRow label="Any time" active={settings.mode === 'ALWAYS'} disabled={disabled} onPress={() => void patch({ mode: 'ALWAYS' })} />
          <ModeRow label="Only outside my opening hours" active={settings.mode === 'AFTER_HOURS_ONLY'} disabled={disabled} onPress={() => void patch({ mode: 'AFTER_HOURS_ONLY' })} />
          <Text style={styles.note}>
            Opening hours come from your business timezone ({view.hours.timezone}) and working hours. {view.hours.resolved
              ? view.hours.open
                ? `You're open now (${view.hours.localTime}).`
                : `You're closed now${view.hours.nextOpen ? ` — next open ${view.hours.nextOpen.label}` : ''}.`
              : 'Set your timezone and working hours in Business profile so this can work.'}
          </Text>
          {settings.mode === 'AFTER_HOURS_ONLY' ? (
            <Text style={styles.note}>{status.currentlyEligible ? 'Answering right now (after hours).' : 'Not answering right now (within opening hours).'}</Text>
          ) : null}
        </M3Card>
      ) : null}

      {settings.enabled ? (
        <M3Card style={styles.card}>
          <Text style={styles.sectionLabel}>CHANNELS</Text>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>SMS</Text>
            <Switch value={settings.smsEnabled} disabled={disabled} onValueChange={v => void patch({ smsEnabled: v })} trackColor={{ false: m3.surfaceContainerHigh, true: m3.secondary }} />
          </View>
          <View style={styles.row}>
            <Text style={styles.rowTitle}>WhatsApp</Text>
            <Switch value={settings.whatsappEnabled} disabled={disabled} onValueChange={v => void patch({ whatsappEnabled: v })} trackColor={{ false: m3.surfaceContainerHigh, true: m3.secondary }} />
          </View>
        </M3Card>
      ) : null}

      <M3Card style={styles.card}>
        <View style={styles.metaRow}><Icon name="policy" size={16} color={m3.onSurfaceVariant} /><Text style={styles.note}>Autonomy: {POLICY_LABEL[status.policyMode] ?? status.policyMode}</Text></View>
        {!status.platformEnabled ? <View style={styles.metaRow}><Icon name="info" size={16} color={m3.onSurfaceVariant} /><Text style={styles.note}>Not yet activated for your account. Contact support to switch it on.</Text></View> : null}
      </M3Card>

      {error ? <Text style={styles.err}>{error}</Text> : null}
    </M3Screen>
  );
}

function ModeRow({ label, active, disabled, onPress }: { label: string; active: boolean; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={onPress} style={styles.modeRow}>
      <View style={[styles.radio, active && styles.radioOn]}>{active ? <View style={styles.radioDot} /> : null}</View>
      <Text style={styles.rowTitle}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, paddingVertical: m3Space.xs },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: m3.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: m3.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: m3.primary },
  intro: { gap: m3Space.xxs, marginBottom: m3Space.md },
  eyebrow: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.8 },
  title: { ...m3Type.headlineSm, color: m3.onSurface },
  sub: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  card: { gap: m3Space.sm, marginBottom: m3Space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  rowTitle: { ...m3Type.bodyLg, color: m3.onSurface, flex: 1 },
  sectionLabel: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.8 },
  note: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.xs },
  err: { ...m3Type.bodySm, color: m3.error },
});
