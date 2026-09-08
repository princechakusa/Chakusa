import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
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
