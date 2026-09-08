import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { CommissionBasis, CommissionReportDto, CommissionRuleDto, commissionsApi, servicesApi, teamApi } from '../services/endpoints';
import { ServiceOfferingDto, TeamMemberDto } from '../apiTypes';
import { ApiError } from '../services/api';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function monthRange(anchor: Date) {
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: key(from), to: key(to), label: from.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
}

function ruleSummary(rule: CommissionRuleDto) {
  const scope = rule.serviceName ?? 'All services';
  const value = rule.basis === 'PERCENT_OF_SERVICE_PRICE' ? `${Number(rule.ratePercent)}%` : `${rule.fixedAmount} ${rule.fixedCurrency ?? ''}`.trim();
  return `${scope} - ${value}`;
}

export function CommissionsScreen() {
  const navigation = useNavigation<Nav>();
  const [anchor, setAnchor] = useState(() => new Date());
  const [report, setReport] = useState<CommissionReportDto | null>(null);
  const [rules, setRules] = useState<CommissionRuleDto[]>([]);
  const [members, setMembers] = useState<TeamMemberDto[]>([]);
  const [services, setServices] = useState<ServiceOfferingDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const range = useMemo(() => monthRange(anchor), [anchor]);

  const load = useCallback(async (soft = false) => {
    soft ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const [reportData, rulesData, memberData, serviceData] = await Promise.all([
        commissionsApi.report(range.from, range.to),
        commissionsApi.rules(),
        teamApi.listMembers(),
        servicesApi.list(true),
      ]);
      setReport(reportData);
      setRules(rulesData);
      setMembers(memberData.filter(m => m.status === 'ACTIVE'));
      setServices(serviceData);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to load commissions.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range.from, range.to]);

  useEffect(() => { void load(); }, [load]);

  const removeRule = async (id: string) => {
    try {
      await commissionsApi.deleteRule(id);
      await load(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to delete the rule.');
    }
  };

  const header = <M3Header businessName="Commissions" onBack={() => navigation.goBack()} onNotificationsPress={() => navigation.navigate('AttentionCenter')} hasNotifications={false} />;

  return (
    <M3Screen header={header} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={m3.primary} />}>
      <View style={styles.intro}>
        <Text style={styles.eyebrow}>TEAM</Text>
        <Text style={styles.title}>Commissions</Text>
        <Text style={styles.introBody}>An operational planning estimate of what each team member earned on completed work. Not payroll, not a payout, and no tax is applied.</Text>
      </View>

      {loading ? <M3Loading label="Loading commissions..." /> : error ? <M3Error message={error} onRetry={() => void load()} /> : (
        <View style={styles.stack}>
          <View style={styles.monthRow}>
            <Pressable accessibilityLabel="Previous month" onPress={() => setAnchor(a => new Date(a.getFullYear(), a.getMonth() - 1, 1))} style={styles.monthBtn}>
              <Icon name="chevron_left" size={22} color={m3.onSurface} />
            </Pressable>
            <Text style={styles.monthLabel}>{range.label}</Text>
            <Pressable accessibilityLabel="Next month" onPress={() => setAnchor(a => new Date(a.getFullYear(), a.getMonth() + 1, 1))} style={styles.monthBtn}>
              <Icon name="chevron_right" size={22} color={m3.onSurface} />
            </Pressable>
          </View>

          {report && report.members.length === 0 ? (
            <M3Empty icon="payments" title="Nothing earned yet" message="Completed appointments with a matching rule will show here." />
          ) : report?.members.map(member => (
            <M3Card key={member.businessMemberId} style={styles.memberCard}>
              <Text style={styles.memberName}>{member.name}</Text>
              {member.currencies.map(c => (
                <View key={c.currency} style={styles.currencyRow}>
                  <Text style={styles.commissionValue}>{c.commission} {c.currency}</Text>
                  <Text style={styles.currencyMeta}>{c.appointmentCount} appt{c.appointmentCount === 1 ? '' : 's'} · {c.serviceRevenue} {c.currency} of service</Text>
                </View>
              ))}
            </M3Card>
          ))}

          {report && report.appointmentsWithoutRule > 0 ? (
            <Text style={styles.note}>{report.appointmentsWithoutRule} completed appointment{report.appointmentsWithoutRule === 1 ? ' has' : 's have'} no commission rule and are not counted.</Text>
          ) : null}
          {report && report.currencyMismatches > 0 ? (
            <Text style={styles.note}>{report.currencyMismatches} fixed rule{report.currencyMismatches === 1 ? '' : 's'} skipped for a currency mismatch.</Text>
          ) : null}

          <View style={styles.rulesHead}>
            <Text style={styles.sectionLabel}>RULES</Text>
            <Pressable accessibilityRole="button" onPress={() => setEditorOpen(true)} style={styles.addBtn}>
              <Icon name="add" size={16} color={m3.onPrimary} />
              <Text style={styles.addBtnText}>Add rule</Text>
            </Pressable>
          </View>
          {rules.length === 0 ? (
            <Text style={styles.note}>No commission rules yet.</Text>
          ) : rules.map(rule => (
            <M3Card key={rule.id} style={styles.ruleRow}>
              <View style={styles.flex}>
                <Text style={styles.ruleMember}>{rule.memberName}</Text>
                <Text style={styles.currencyMeta}>{ruleSummary(rule)}</Text>
              </View>
              <Pressable accessibilityLabel="Delete rule" onPress={() => void removeRule(rule.id)} style={styles.deleteBtn}>
                <Icon name="delete" size={18} color={m3.error} />
              </Pressable>
            </M3Card>
          ))}
        </View>
      )}

      <RuleEditor
        visible={editorOpen}
        members={members}
        services={services}
        defaultCurrency={report?.currency ?? 'USD'}
        onClose={() => setEditorOpen(false)}
        onSaved={async () => { setEditorOpen(false); await load(true); }}
      />
    </M3Screen>
  );
}

function RuleEditor({ visible, members, services, defaultCurrency, onClose, onSaved }: {
  visible: boolean;
  members: TeamMemberDto[];
  services: ServiceOfferingDto[];
  defaultCurrency: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [memberId, setMemberId] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [basis, setBasis] = useState<CommissionBasis>('PERCENT_OF_SERVICE_PRICE');
  const [percent, setPercent] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setMemberId(members[0]?.id ?? '');
      setServiceId(null);
      setBasis('PERCENT_OF_SERVICE_PRICE');
      setPercent('');
      setAmount('');
      setErr(null);
    }
  }, [visible, members]);

  const save = async () => {
    if (busy || !memberId) return;
    setBusy(true);
    setErr(null);
    try {
      await commissionsApi.upsertRule({
        businessMemberId: memberId,
        serviceOfferingId: serviceId,
        basis,
        ...(basis === 'PERCENT_OF_SERVICE_PRICE' ? { ratePercent: Number(percent) } : { fixedAmount: Number(amount), fixedCurrency: defaultCurrency }),
      });
      await onSaved();
    } catch (caught) {
      setErr(caught instanceof ApiError ? caught.message : 'Unable to save the rule.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <Text style={styles.sheetTitle}>New commission rule</Text>

          <Text style={styles.fieldLabel}>Team member</Text>
          <View style={styles.chipWrap}>
            {members.map(m => <Chip key={m.id} label={m.name} selected={memberId === m.id} onPress={() => setMemberId(m.id)} />)}
          </View>

          <Text style={styles.fieldLabel}>Applies to</Text>
          <View style={styles.chipWrap}>
            <Chip label="All services" selected={serviceId === null} onPress={() => setServiceId(null)} />
            {services.map(s => <Chip key={s.id} label={s.name} selected={serviceId === s.id} onPress={() => setServiceId(s.id)} />)}
          </View>

          <Text style={styles.fieldLabel}>Basis</Text>
          <View style={styles.chipWrap}>
            <Chip label="% of service price" selected={basis === 'PERCENT_OF_SERVICE_PRICE'} onPress={() => setBasis('PERCENT_OF_SERVICE_PRICE')} />
            <Chip label="Fixed per appointment" selected={basis === 'FIXED_PER_APPOINTMENT'} onPress={() => setBasis('FIXED_PER_APPOINTMENT')} />
          </View>

          {basis === 'PERCENT_OF_SERVICE_PRICE' ? (
            <>
              <Text style={styles.fieldLabel}>Percentage</Text>
              <TextInput value={percent} onChangeText={setPercent} keyboardType="decimal-pad" placeholder="e.g. 20" placeholderTextColor={m3.onSurfaceVariant} style={styles.input} />
            </>
          ) : (
            <>
              <Text style={styles.fieldLabel}>Amount ({defaultCurrency})</Text>
              <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="e.g. 15" placeholderTextColor={m3.onSurfaceVariant} style={styles.input} />
            </>
          )}

          {err ? <Text style={styles.err}>{err}</Text> : null}
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void save()} style={styles.saveBtn}>
            <Text style={styles.saveBtnText}>{busy ? 'Saving...' : 'Save rule'}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: m3Space.md },
  intro: { gap: m3Space.xxs, marginBottom: m3Space.md },
  eyebrow: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.8 },
  title: { ...m3Type.headlineSm, color: m3.onSurface },
  introBody: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  monthBtn: { width: 40, height: 40, borderRadius: m3Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: m3.surfaceContainerHigh },
  monthLabel: { ...m3Type.titleMd, color: m3.onSurface, flex: 1 },
  memberCard: { gap: m3Space.xs },
  memberName: { ...m3Type.titleMd, color: m3.onSurface },
  currencyRow: { gap: 2 },
  commissionValue: { ...m3Type.headlineSm, color: m3.primary },
  currencyMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  note: { ...m3Type.bodySm, color: m3.onSurfaceVariant, fontStyle: 'italic' },
  rulesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: m3Space.sm },
  sectionLabel: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.8 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: m3Space.xxs, paddingHorizontal: m3Space.sm, height: 34, borderRadius: m3Radius.full, backgroundColor: m3.primary },
  addBtnText: { ...m3Type.labelMd, color: m3.onPrimary },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  ruleMember: { ...m3Type.bodyLg, color: m3.onSurface },
  deleteBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  overlay: { flex: 1, backgroundColor: 'rgba(19,27,46,0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: m3.surfaceContainerHigh, borderTopLeftRadius: m3Radius.xl, borderTopRightRadius: m3Radius.xl, padding: m3Space.lg, gap: m3Space.sm },
  sheetTitle: { ...m3Type.titleMd, color: m3.onSurface },
  fieldLabel: { ...m3Type.labelMd, color: m3.onSurfaceVariant, marginTop: m3Space.xs },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },
  input: { height: 48, borderRadius: m3Radius.md, backgroundColor: m3.surface, borderWidth: 1, borderColor: m3.outlineVariant, paddingHorizontal: m3Space.md, ...m3Type.bodyLg, color: m3.onSurface },
  err: { ...m3Type.bodySm, color: m3.error },
  saveBtn: { height: 48, borderRadius: m3Radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: m3.primary, marginTop: m3Space.sm },
  saveBtnText: { ...m3Type.labelLg, color: m3.onPrimary },
});
