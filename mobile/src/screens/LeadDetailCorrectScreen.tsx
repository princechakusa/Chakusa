import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { LeadDto, LeadPaymentStatus, LeadStatus } from '../apiTypes';
import { getAllowedLeadTransitions } from '../domain/mobileDomain';
import { ApiError } from '../services/api';
import { leadsApi } from '../services/endpoints';
import { copyMessage, openSms, openWhatsApp } from '../services/messaging';
import { useAppState } from '../state/AppContext';
import { colors, radius, spacing, typography } from '../theme';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen, SectionTitle } from '../experience/businessKit';
import { RootStackParamList, TimelineItem } from '../types';
import { formatDateTime, formatDuration, formatMoney, titleCase } from '../utils/format';

function initials(name: string | null | undefined) {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

type Props = NativeStackScreenProps<RootStackParamList, 'LeadDetail'>;
export function LeadDetailCorrectScreen({ route, navigation }: Props) {
  const { loadLeads, loadDashboard } = useAppState();
  const [lead, setLead] = useState<LeadDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutation, setMutation] = useState<string | null>(null);
  const [paymentEditing, setPaymentEditing] = useState(false);
  const [paidAmountInput, setPaidAmountInput] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setLead(await leadsApi.get(route.params.leadId));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to load lead.');
    } finally {
      setLoading(false);
    }
  }, [route.params.leadId]);
  useEffect(() => {
    void load();
  }, [load]);

  const timeline = useMemo<TimelineItem[]>(
    () =>
      lead
        ? [
            { id: 'missed', date: 'MISSED', title: 'Incoming call', detail: formatDateTime(lead.missedCallTime), tone: 'attention' },
            ...(lead.contactedAt
              ? [{ id: 'contacted', date: 'CONTACTED', title: 'Follow-up recorded', detail: formatDateTime(lead.contactedAt), tone: 'success' as const }]
              : []),
            ...(lead.bookedAt
              ? [{ id: 'booked', date: 'BOOKED', title: 'Appointment booked', detail: formatDateTime(lead.bookedAt), tone: 'success' as const }]
              : []),
            ...(lead.wonAt
              ? [{ id: 'won', date: 'WON', title: 'Lead won', detail: formatDateTime(lead.wonAt), value: formatMoney(lead.estimatedValue), tone: 'success' as const }]
              : []),
            ...(lead.lostAt ? [{ id: 'lost', date: 'LOST', title: 'Lead lost', detail: formatDateTime(lead.lostAt) }] : []),
          ]
        : [],
    [lead],
  );

  const generate = async () => {
    if (!lead || mutation) return;
    setMutation('generate');
    try {
      const result = await leadsApi.generateMessage(lead.id);
      setLead((current) => (current ? { ...current, generatedReply: result.message } : current));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to prepare message.');
    } finally {
      setMutation(null);
    }
  };
  const transition = async (status: Exclude<LeadStatus, 'new'>) => {
    if (!lead || mutation) return;
    setMutation(status);
    setError(null);
    try {
      const result = await leadsApi.transition(lead.id, status);
      setLead(result);
      await Promise.all([loadLeads(), loadDashboard()]);
      Alert.alert(`Marked ${titleCase(status)}`, status === 'won' ? 'Nice work - this is now counted in your recovered revenue.' : undefined);
    } catch (caught) {
      if (caught instanceof ApiError && caught.kind === 'conflict') {
        setError('This lead changed elsewhere. We refreshed its current status.');
        await load();
      } else setError(caught instanceof ApiError ? caught.message : 'Unable to update lead.');
    } finally {
      setMutation(null);
    }
  };
  const updatePayment = async (paymentStatus: LeadPaymentStatus) => {
    if (!lead || mutation) return;
    const paidAmount = paymentStatus === 'unpaid' ? undefined : Number(paidAmountInput);
    if (paymentStatus !== 'unpaid' && (!paidAmountInput.trim() || Number.isNaN(paidAmount))) {
      setError('Enter a valid amount.');
      return;
    }
    setMutation('payment');
    setError(null);
    try {
      const result = await leadsApi.updatePayment(lead.id, { paymentStatus, paidAmount });
      setLead(result);
      await loadDashboard();
      setPaymentEditing(false);
      setPaidAmountInput('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to update payment status.');
    } finally {
      setMutation(null);
    }
  };

  const header = <M3Header businessName="Lead" onBack={() => navigation.goBack()} />;

  if (loading && !lead) {
    return (
      <M3Screen header={header}>
        <M3Loading label="Loading lead…" />
      </M3Screen>
    );
  }
  if (error && !lead) {
    return (
      <M3Screen header={header}>
        <M3Error message={error} onRetry={() => void load()} />
      </M3Screen>
    );
  }
  if (!lead) {
    return (
      <M3Screen header={header}>
        <M3Empty title="Lead not found" message="This lead is no longer available." />
      </M3Screen>
    );
  }

  const phone = lead.customer?.phone ?? '';
  const message = lead.generatedReply;
  const actions = getAllowedLeadTransitions(lead.status);

  return (
    <M3Screen header={header}>
      <View style={styles.identityRow}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(lead.customer?.name)}</Text>
        </View>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={styles.name}>
            {lead.customer?.name ?? 'Unassigned lead'}
          </Text>
          <Text numberOfLines={1} style={styles.subMeta}>
            {phone || 'No phone number'}
          </Text>
        </View>
        <Chip
          label={titleCase(lead.status)}
          tone={lead.status === 'won' ? 'secondary' : lead.status === 'lost' ? 'error' : 'neutral'}
        />
      </View>

      <M3Card style={styles.infoCard}>
        <InfoLine label="Service" value={lead.serviceRequested ?? 'Not specified'} />
        <InfoLine label="Urgency" value={titleCase(lead.urgency)} />
        <InfoLine label="Missed call" value={formatDateTime(lead.missedCallTime)} />
        <InfoLine label="Estimated value" value={formatMoney(lead.estimatedValue)} last={!lead.referredBy} />
        {lead.referredBy ? <InfoLine label="Referred by" value={lead.referredBy.name} last /> : null}
      </M3Card>
      {lead.referredBy ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('CustomerProfile', { customerId: lead.referredBy!.id })}
          style={styles.ghostBtn}
        >
          <Text style={styles.ghostBtnText}>View {lead.referredBy.name}</Text>
        </Pressable>
      ) : null}
      {lead.responseTimeSeconds != null ? (
        <Text style={styles.responseTime}>Response time: {formatDuration(lead.responseTimeSeconds)}</Text>
      ) : null}

      <View style={styles.gap8}>
        <SectionTitle title="Message" />
        {message ? (
          <M3Card style={styles.messageCard}>
            <Text style={styles.messageText}>{message}</Text>
            <View style={styles.actionsRow}>
              <Pressable accessibilityRole="button" onPress={() => void copyMessage(message)} style={styles.ghostChip}>
                <Icon name="content_copy" size={14} color={m3.onSurface} />
                <Text style={styles.ghostChipText}>Copy</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={!phone} onPress={() => void openSms(phone, message)} style={[styles.ghostChip, !phone && styles.disabled]}>
                <Icon name="sms" size={14} color={m3.onSurface} />
                <Text style={styles.ghostChipText}>Open SMS</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={!phone} onPress={() => void openWhatsApp(phone, message)} style={[styles.ghostChip, !phone && styles.disabled]}>
                <Icon name="forum" size={14} color={m3.onSurface} />
                <Text style={styles.ghostChipText}>Open WhatsApp</Text>
              </Pressable>
            </View>
          </M3Card>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={Boolean(mutation)}
            onPress={() => void generate()}
            style={[styles.primaryBtn, Boolean(mutation) && styles.disabled]}
          >
            <Text style={styles.primaryBtnText}>{mutation === 'generate' ? 'Preparing…' : 'Prepare message'}</Text>
          </Pressable>
        )}
      </View>

      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}

      {actions.length ? (
        <View style={styles.gap8}>
          <SectionTitle title="Next step" />
          <View style={styles.actionsRow}>
            {actions.map((status) => (
              <Pressable
                key={status}
                accessibilityRole="button"
                disabled={Boolean(mutation)}
                onPress={() => void transition(status)}
                style={[styles.ghostChip, Boolean(mutation) && styles.disabled]}
              >
                <Text style={styles.ghostChipText}>{mutation === status ? 'Saving…' : `Mark ${titleCase(status)}`}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <M3Card style={styles.terminalCard}>
          <Text style={styles.body}>This lead is {lead.status}. No further status actions are available.</Text>
        </M3Card>
      )}

      {lead.status === 'won' ? (
        <M3Card style={styles.paymentCard}>
          <SectionTitle title="Payment" />
          <View style={styles.paymentRow}>
            <Text style={styles.body}>
              {lead.paymentStatus === 'paid'
                ? `Paid${lead.paidAmount != null ? ` - ${formatMoney(lead.paidAmount)}` : ''}`
                : lead.paymentStatus === 'partially_paid'
                  ? `Partially paid${lead.paidAmount != null ? ` - ${formatMoney(lead.paidAmount)} so far` : ''}`
                  : 'Not marked paid yet'}
            </Text>
            <Chip label={titleCase(lead.paymentStatus)} tone={lead.paymentStatus === 'paid' ? 'secondary' : 'neutral'} />
          </View>
          {paymentEditing ? (
            <>
              <TextInput
                accessibilityLabel="Amount paid"
                value={paidAmountInput}
                onChangeText={setPaidAmountInput}
                placeholder="Amount"
                keyboardType="decimal-pad"
                placeholderTextColor={m3.onSurfaceVariant}
                style={styles.paymentInput}
              />
              <View style={styles.actionsRow}>
                <Pressable accessibilityRole="button" disabled={Boolean(mutation)} onPress={() => void updatePayment('paid')} style={styles.ghostChip}>
                  <Text style={styles.ghostChipText}>{mutation === 'payment' ? 'Saving…' : 'Paid in full'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={Boolean(mutation)} onPress={() => void updatePayment('partially_paid')} style={styles.ghostChip}>
                  <Text style={styles.ghostChipText}>{mutation === 'payment' ? 'Saving…' : 'Partially paid'}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setPaymentEditing(false);
                    setPaidAmountInput('');
                  }}
                  style={styles.ghostChip}
                >
                  <Text style={styles.ghostChipText}>Cancel</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.actionsRow}>
              {lead.paymentStatus !== 'paid' ? (
                <Pressable accessibilityRole="button" onPress={() => setPaymentEditing(true)} style={styles.ghostChip}>
                  <Text style={styles.ghostChipText}>Record payment</Text>
                </Pressable>
              ) : null}
              {lead.paymentStatus !== 'unpaid' ? (
                <Pressable accessibilityRole="button" disabled={Boolean(mutation)} onPress={() => void updatePayment('unpaid')} style={styles.ghostChip}>
                  <Text style={styles.ghostChipText}>Mark unpaid</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </M3Card>
      ) : null}

      {lead.status === 'won' && lead.customerId ? (
        <M3Card style={styles.nudgeCard}>
          <Text style={styles.nudgeTitle}>Bring them back</Text>
          <Text style={styles.body}>Set a reminder now so {lead.customer?.name ?? 'this customer'} hears from you again at the right time.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Comeback', { presetCustomerId: lead.customerId! })}
            style={styles.nudgeBtn}
          >
            <Text style={styles.nudgeBtnText}>Set a reminder</Text>
          </Pressable>
        </M3Card>
      ) : null}

      <View style={styles.gap8}>
        <SectionTitle title="Timeline" />
        <View style={styles.timeline}>
          {timeline.map((item, index) => (
            <View key={item.id} style={styles.timelineRow}>
              <View style={styles.timelineRail}>
                <View style={[styles.timelineDot, item.tone === 'success' && styles.dotSuccess, item.tone === 'attention' && styles.dotAttention]} />
                {index < timeline.length - 1 ? <View style={styles.timelineLine} /> : null}
              </View>
              <View style={styles.timelineContent}>
                <Text style={styles.timelineDate}>{item.date}</Text>
                <View style={styles.timelineTitleRow}>
                  <Text style={styles.timelineTitle}>{item.title}</Text>
                  {item.value ? <Text style={styles.timelineValue}>{item.value}</Text> : null}
                </View>
                {item.detail ? <Text style={styles.timelineDetail}>{item.detail}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      </View>

      {lead.customerId ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('CustomerProfile', { customerId: lead.customerId! })}
          style={styles.primaryBtn}
        >
          <Text style={styles.primaryBtnText}>View customer profile</Text>
        </Pressable>
      ) : null}
    </M3Screen>
  );
}

function InfoLine({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.rowDivider]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text numberOfLines={1} style={styles.infoValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  gap8: { gap: m3Space.xs },
  disabled: { opacity: 0.5 },

  identityRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  avatar: { width: 52, height: 52, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...m3Type.headlineSm, color: m3.primary },
  name: { ...m3Type.headlineSm, fontSize: 19, color: m3.onSurface },
  subMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },

  infoCard: { gap: 0 },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, gap: m3Space.sm },
  infoLabel: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  infoValue: { ...m3Type.labelMd, color: m3.onSurface, flexShrink: 1, textAlign: 'right' },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: m3.surfaceContainerHigh },

  ghostBtn: { alignSelf: 'flex-start', height: 36, paddingHorizontal: 14, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { ...m3Type.labelMd, color: m3.onSurface },
  responseTime: { ...m3Type.labelLg, color: m3.onSurface },

  messageCard: { gap: m3Space.sm },
  messageText: { ...m3Type.bodyMd, color: m3.onSurface },
  actionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },
  ghostChip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainerLow },
  ghostChipText: { ...m3Type.labelMd, color: m3.onSurface },

  primaryBtn: { height: 46, borderRadius: m3Radius.md, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { ...m3Type.labelLg, color: m3.onPrimary },

  error: { ...m3Type.bodySm, color: m3.error },

  terminalCard: {},
  body: { ...m3Type.bodyMd, color: m3.onSurface },

  paymentCard: { gap: m3Space.sm },
  paymentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m3Space.sm },
  paymentInput: { minHeight: 46, backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.md, paddingHorizontal: m3Space.md, ...m3Type.bodyMd, color: m3.onSurface },

  nudgeCard: { gap: m3Space.xs, backgroundColor: m3.primaryFixed },
  nudgeTitle: { ...m3Type.labelLg, color: m3.onPrimaryFixedVariant },
  nudgeBtn: { alignSelf: 'flex-start', height: 38, paddingHorizontal: 14, borderRadius: m3Radius.full, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  nudgeBtnText: { ...m3Type.labelMd, color: m3.onPrimary },

  timeline: { gap: 0 },
  timelineRow: { flexDirection: 'row', gap: m3Space.sm },
  timelineRail: { alignItems: 'center', width: 16 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: m3.outlineVariant, marginTop: 4 },
  dotSuccess: { backgroundColor: m3.secondary },
  dotAttention: { backgroundColor: m3.primary },
  timelineLine: { flex: 1, width: 2, backgroundColor: m3.surfaceContainerHigh, marginTop: 2 },
  timelineContent: { flex: 1, paddingBottom: m3Space.md },
  timelineDate: { ...m3Type.labelXs, color: m3.onSurfaceVariant },
  timelineTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m3Space.xs, marginTop: 2 },
  timelineTitle: { ...m3Type.labelLg, color: m3.onSurface, flexShrink: 1 },
  timelineValue: { ...m3Type.labelMd, color: m3.secondary },
  timelineDetail: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
});
