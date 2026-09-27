import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { AudienceCenterDto, CustomerProfileDto } from '../apiTypes';
import { CustomerTags } from '../components/CustomerTags';
import { PrimaryButton } from '../components/ui';
import { CountryPhoneInput } from '../components/CountryPhoneInput';
import { availableCommunicationTabs, CommunicationTab, communicationTabLabel, filterCommunicationEntries, toTimelineItem } from '../domain/communicationTimeline';
import { publicBusinessProfileUrl } from '../domain/publicBusinessProfile';
import { openCall, openWhatsApp } from '../services/messaging';
import { ApiError } from '../services/api';
import { customersApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { colors, radius, spacing, typography } from '../theme';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen, SectionTitle } from '../experience/businessKit';
import { RootStackParamList, TimelineItem } from '../types';
import { formatDate, formatMoney, titleCase } from '../utils/format';

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

type Props = NativeStackScreenProps<RootStackParamList, 'CustomerProfile'>;
export function CustomerProfileScreen({ route, navigation }: Props) {
  const { business } = useAuth();
  const [profile, setProfile] = useState<CustomerProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [tab, setTab] = useState<CommunicationTab>('all');
  const [audiences, setAudiences] = useState<AudienceCenterDto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await customersApi.get(route.params.customerId);
      setProfile(result);
      setName(result.customer.name);
      setPhone(result.customer.phone ?? '');
      setEmail(result.customer.email ?? '');
      setNotes(result.customer.notes ?? '');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to load customer.');
    } finally {
      setLoading(false);
    }
  }, [route.params.customerId]);
  useEffect(() => {
    void load();
  }, [load]);
  const refreshTags = useCallback(() => {
    void customersApi.audiences().then(setAudiences).catch(() => setAudiences(null));
  }, []);
  useEffect(() => {
    refreshTags();
  }, [refreshTags]);

  const tabs = useMemo(() => (profile ? availableCommunicationTabs(profile.communicationTimeline) : ['all' as const]), [profile]);
  const timelineItems = useMemo<TimelineItem[]>(() => {
    if (!profile) return [];
    return filterCommunicationEntries(profile.communicationTimeline, tab).map((entry) =>
      toTimelineItem(entry, {
        onViewLead: (leadId) => navigation.navigate('LeadDetail', { leadId }),
        onViewReview: (reviewRequestId) => navigation.navigate('ReviewDetail', { reviewId: reviewRequestId }),
      }),
    );
  }, [profile, tab, navigation]);

  const save = async () => {
    if (!profile || saving) return;
    setSaving(true);
    setError(null);
    try {
      await customersApi.patch(profile.customer.id, {
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      setEditing(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to update customer.');
    } finally {
      setSaving(false);
    }
  };

  const header = <M3Header businessName="Client Profile" onBack={() => navigation.goBack()} />;

  if (loading && !profile) {
    return (
      <M3Screen header={header}>
        <M3Loading label="Loading customer profile…" />
      </M3Screen>
    );
  }
  if (error && !profile) {
    return (
      <M3Screen header={header}>
        <M3Error message={error} onRetry={() => void load()} />
      </M3Screen>
    );
  }
  if (!profile) {
    return (
      <M3Screen header={header}>
        <M3Empty title="Customer not found" message="This customer is no longer available." />
      </M3Screen>
    );
  }

  const customer = profile.customer;
  const lastVisit = profile.reminders
    .map((item) => item.lastVisitDate)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  const referralUrl = business?.publicSlug ? publicBusinessProfileUrl(business.publicSlug, customer.id) : null;
  const copyReferralUrl = async () => {
    if (!referralUrl) return;
    await Clipboard.setStringAsync(referralUrl);
    Alert.alert('Copied', `${customer.name}'s referral link was copied.`);
  };
  const shareReferralUrl = async () => {
    if (!referralUrl) return;
    try {
      await Share.share({ message: `${customer.name}, thanks for being a customer! Share this link with a friend: ${referralUrl}` });
    } catch {
      /* user dismissed the share sheet */
    }
  };

  const greeting = `Hi ${customer.name}, this is ${business?.name ?? 'us'}.`;
  const outstandingLead = profile.leads.find((item) => item.status === 'won' && item.paymentStatus !== 'paid');
  const showRequestReview = !profile.communicationStatuses.includes('waiting_for_review');
  const showCreateReminder = !profile.communicationStatuses.includes('reminder_scheduled');

  const runQuickAction = (kind: 'call' | 'whatsapp' | 'schedule' | 'requestReview' | 'createReminder' | 'recordPayment') => {
    if (kind === 'call' && customer.phone) void openCall(customer.phone);
    else if (kind === 'whatsapp' && customer.phone) void openWhatsApp(customer.phone, greeting);
    else if (kind === 'schedule') navigation.navigate('AppointmentEditor');
    else if (kind === 'requestReview') navigation.navigate('Main', { screen: 'Reviews', params: { presetCustomerId: customer.id } });
    else if (kind === 'createReminder') navigation.navigate('Comeback', { presetCustomerId: customer.id });
    else if (kind === 'recordPayment' && outstandingLead) navigation.navigate('LeadDetail', { leadId: outstandingLead.id });
  };

  const quickActions: { icon: string; label: string; kind: Parameters<typeof runQuickAction>[0] }[] = [
    { icon: 'event', label: 'Schedule', kind: 'schedule' },
    ...(customer.phone ? [{ icon: 'call', label: 'Call', kind: 'call' as const }] : []),
    ...(customer.phone ? [{ icon: 'forum', label: 'WhatsApp', kind: 'whatsapp' as const }] : []),
    ...(showRequestReview ? [{ icon: 'star', label: 'Request review', kind: 'requestReview' as const }] : []),
    ...(showCreateReminder ? [{ icon: 'alarm', label: 'Create reminder', kind: 'createReminder' as const }] : []),
    ...(outstandingLead ? [{ icon: 'local_atm', label: 'Record payment', kind: 'recordPayment' as const }] : []),
  ];

  return (
    <>
      <M3Screen header={header}>
        <View style={styles.identityRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(customer.name)}</Text>
          </View>
          <View style={styles.flex}>
            <Text numberOfLines={1} style={styles.name}>
              {customer.name}
            </Text>
            <Text numberOfLines={1} style={styles.subMeta}>
              {customer.phone ?? customer.email ?? 'No contact details'}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit customer" onPress={() => setEditing(true)} style={styles.editBtn}>
            <Icon name="edit" size={18} color={m3.onSurface} />
          </Pressable>
        </View>

        <M3Card style={styles.metricsCard} padded={false}>
          <View
            accessibilityLabel={`Lifetime value ${formatMoney(profile.lifetimeValue)}, ${profile.leads.length} leads, ${profile.reviewRequests.length} review requests`}
            style={styles.metricsRow}
          >
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>LIFETIME VALUE</Text>
              <Text style={styles.metricValue}>{formatMoney(profile.lifetimeValue)}</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>LEADS</Text>
              <Text style={styles.metricValue}>{profile.leads.length}</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>REVIEWS</Text>
              <Text style={styles.metricValue}>{profile.reviewRequests.length}</Text>
            </View>
          </View>
        </M3Card>

        <M3Card style={styles.infoCard}>
          <InfoLine label="Email" value={customer.email ?? 'Not set'} />
          <InfoLine label="Phone" value={customer.phone ?? 'Not set'} />
          <InfoLine label="Last visit" value={lastVisit ? formatDate(lastVisit) : 'Not recorded'} />
          <InfoLine label="Notes" value={customer.notes ?? 'None'} />
          <InfoLine label="Customer since" value={formatDate(customer.createdAt)} last />
        </M3Card>

        {referralUrl ? (
          <M3Card style={styles.referralCard}>
            <Text style={styles.referralLabel}>Ask {customer.name} to refer a friend</Text>
            <View style={styles.referralActions}>
              <Pressable accessibilityRole="button" onPress={() => void copyReferralUrl()} style={styles.referralGhostBtn}>
                <Text style={styles.referralGhostText}>Copy link</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => void shareReferralUrl()} style={styles.referralPrimaryBtn}>
                <Text style={styles.referralPrimaryText}>Share</Text>
              </Pressable>
            </View>
          </M3Card>
        ) : null}

        {audiences ? <CustomerTags customerId={customer.id} data={audiences} onChanged={refreshTags} /> : null}

        {profile.communicationStatuses.length > 0 ? (
          <View style={styles.chipsWrap}>
            {profile.communicationStatuses.map((status) => (
              <Chip key={status} label={titleCase(status)} tone="secondary" />
            ))}
          </View>
        ) : null}

        {profile.assistantHighlight ? (
          <M3Card style={styles.assistantCard}>
            <View style={styles.assistantHead}>
              <Icon name="smart_toy" size={16} color={m3.primary} />
              <Text style={styles.assistantEyebrow}>BUSINESS ASSISTANT</Text>
            </View>
            <Text style={styles.assistantTitle}>{profile.assistantHighlight.title}</Text>
            <View style={styles.evidenceList}>
              {profile.assistantHighlight.evidence.map((line) => (
                <Text key={line} style={styles.assistantEvidence}>
                  · {line}
                </Text>
              ))}
            </View>
            <Text style={styles.assistantAction}>{profile.assistantHighlight.recommendedAction}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => runQuickAction(profile.assistantHighlight!.quickAction)}
              style={styles.assistantButton}
            >
              <Text style={styles.assistantButtonText}>{quickActionLabel(profile.assistantHighlight.quickAction)}</Text>
            </Pressable>
          </M3Card>
        ) : null}

        <View style={styles.gap8}>
          <SectionTitle title="Quick actions" />
          <View style={styles.quickActionsRow}>
            {quickActions.map((action) => (
              <Pressable key={action.label} accessibilityRole="button" onPress={() => runQuickAction(action.kind)} style={styles.quickChip}>
                <Icon name={action.icon} size={15} color={m3.onSurface} />
                <Text style={styles.quickChipText}>{action.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.gap8}>
          <SectionTitle title="Appointments" actionLabel="Schedule" onAction={() => runQuickAction('schedule')} />
          {profile.appointments.length ? (
            <M3Card padded={false}>
              {profile.appointments.slice(0, 5).map((item, index) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => navigation.navigate('AppointmentEditor', { appointmentId: item.id })}
                  style={[styles.appointmentRow, index > 0 && styles.rowDivider]}
                >
                  <View style={styles.appointmentDay}>
                    <Text style={styles.appointmentDayText}>{new Date(item.startsAt).getDate()}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text numberOfLines={1} style={styles.appointmentTitle}>
                      {item.serviceName}
                    </Text>
                    <Text numberOfLines={1} style={styles.appointmentMeta}>
                      {new Date(item.startsAt).toLocaleString()} · {titleCase(item.status)}
                    </Text>
                  </View>
                  <Chip label={titleCase(item.status)} tone="neutral" />
                </Pressable>
              ))}
            </M3Card>
          ) : (
            <Text style={styles.muted}>No appointments recorded for this customer.</Text>
          )}
        </View>

        <View style={styles.gap8}>
          <SectionTitle title="Communication timeline" />
          {tabs.length > 1 ? (
            <View style={styles.chipsWrap}>
              {tabs.map((t) => (
                <Chip key={t} label={communicationTabLabel(t)} selected={tab === t} onPress={() => setTab(t)} />
              ))}
            </View>
          ) : null}
          {timelineItems.length ? (
            <View style={styles.timeline}>
              {timelineItems.map((item, index) => (
                <View key={item.id} style={styles.timelineRow}>
                  <View style={styles.timelineRail}>
                    <View style={[styles.timelineDot, item.tone === 'success' && styles.dotSuccess, item.tone === 'attention' && styles.dotAttention]} />
                    {index < timelineItems.length - 1 ? <View style={styles.timelineLine} /> : null}
                  </View>
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineDate}>{item.date}</Text>
                    <View style={styles.timelineTitleRow}>
                      <Text style={styles.timelineTitle}>{item.title}</Text>
                      {item.value ? <Text style={styles.timelineValue}>{item.value}</Text> : null}
                    </View>
                    {item.detail ? <Text style={styles.timelineDetail}>{item.detail}</Text> : null}
                    {item.actionLabel && item.onPressAction ? (
                      <Pressable accessibilityRole="button" onPress={item.onPressAction} hitSlop={8}>
                        <Text style={styles.timelineAction}>{item.actionLabel}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <M3Empty
              icon="forum"
              title="No communication yet"
              message="Every lead, message, review, reminder, and payment for this customer will show up here."
            />
          )}
        </View>
      </M3Screen>

      <Modal visible={editing} transparent animationType="slide" onRequestClose={() => setEditing(false)}>
        <Pressable style={styles.overlay} onPress={() => !saving && setEditing(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
              <Text style={styles.sheetTitle}>Edit customer</Text>
              <Field label="Name" value={name} onChangeText={setName} />
              <CountryPhoneInput value={phone} onChange={setPhone} />
              <Field label="Email" value={email} onChangeText={setEmail} />
              <Field label="Notes" value={notes} onChangeText={setNotes} />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <PrimaryButton disabled={saving || !name.trim()} fullWidth label={saving ? 'Saving…' : 'Save changes'} onPress={() => void save()} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function quickActionLabel(kind: 'recordPayment' | 'createReminder' | 'requestReview'): string {
  return ({ recordPayment: 'Record payment', createReminder: 'Create reminder', requestReview: 'Request review' } as const)[kind];
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

function Field({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void }) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput accessibilityLabel={label} {...props} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  gap8: { gap: m3Space.xs },

  identityRow: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  avatar: { width: 56, height: 56, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...m3Type.headlineSm, color: m3.primary },
  name: { ...m3Type.headlineMd, color: m3.onSurface },
  subMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
  editBtn: { width: 40, height: 40, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },

  metricsCard: { backgroundColor: m3.onBackground },
  metricsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: m3Space.md },
  metric: { flex: 1, alignItems: 'center' },
  metricLabel: { ...m3Type.labelXs, color: 'rgba(255,255,255,0.7)' },
  metricValue: { ...m3Type.headlineSm, color: m3.surfaceContainerLowest, marginTop: 2 },
  metricDivider: { width: 1, height: 34, backgroundColor: 'rgba(255,255,255,0.2)' },

  infoCard: { gap: 0 },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, gap: m3Space.sm },
  infoLabel: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  infoValue: { ...m3Type.labelMd, color: m3.onSurface, flexShrink: 1, textAlign: 'right' },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: m3.surfaceContainerHigh },

  referralCard: { gap: m3Space.xs },
  referralLabel: { ...m3Type.labelLg, color: m3.onSurface },
  referralActions: { flexDirection: 'row', gap: m3Space.xs },
  referralGhostBtn: { flex: 1, height: 40, borderRadius: m3Radius.full, borderWidth: 1, borderColor: m3.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  referralGhostText: { ...m3Type.labelMd, color: m3.onSurface },
  referralPrimaryBtn: { flex: 1, height: 40, borderRadius: m3Radius.full, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  referralPrimaryText: { ...m3Type.labelMd, color: m3.onPrimary },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },

  assistantCard: { gap: 6, borderWidth: 1, borderColor: m3.primary },
  assistantHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assistantEyebrow: { ...m3Type.labelSm, color: m3.primary, letterSpacing: 0.5 },
  assistantTitle: { ...m3Type.labelLg, color: m3.onSurface },
  evidenceList: { gap: 2 },
  assistantEvidence: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  assistantAction: { ...m3Type.bodySm, color: m3.onSurface, fontStyle: 'italic' },
  assistantButton: { height: 38, borderRadius: m3Radius.full, borderWidth: 1, borderColor: m3.primary, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  assistantButtonText: { ...m3Type.labelMd, color: m3.primary },

  quickActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },
  quickChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerLow },
  quickChipText: { ...m3Type.labelMd, color: m3.onSurface },

  appointmentRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, padding: m3Space.sm },
  appointmentDay: { width: 36, height: 36, borderRadius: m3Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: m3.surfaceContainerHigh },
  appointmentDayText: { ...m3Type.labelLg, color: m3.primary },
  appointmentTitle: { ...m3Type.labelLg, color: m3.onSurface },
  appointmentMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  muted: { ...m3Type.bodyMd, color: m3.onSurfaceVariant },

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
  timelineAction: { ...m3Type.labelMd, color: m3.primary, marginTop: 4 },

  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { maxHeight: '92%', backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  sheetContent: { padding: spacing.xl, paddingBottom: 40, gap: spacing.md },
  sheetTitle: { ...typography.heading, color: colors.text },
  fieldLabel: { ...typography.caption, color: colors.text, marginBottom: spacing.xs },
  input: { minHeight: 48, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, ...typography.body, color: colors.text },
  error: { ...typography.caption, color: colors.negative },
});
