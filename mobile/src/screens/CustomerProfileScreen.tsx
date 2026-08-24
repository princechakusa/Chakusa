import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { AudienceCenterDto, CustomerProfileDto } from '../apiTypes';
import { CustomerTags } from '../components/CustomerTags';
import { AppHeader, Avatar, EmptyState, ErrorState, FilterTabs, IconButton, InfoRow, LoadingState, PrimaryButton, Reveal, Screen, SecondaryButton, SectionHeader, StatusBadge, Timeline } from '../components/ui';
import { CountryPhoneInput } from '../components/CountryPhoneInput';
import { availableCommunicationTabs, CommunicationTab, filterCommunicationEntries, toTimelineItem } from '../domain/communicationTimeline';
import { publicBusinessProfileUrl } from '../domain/publicBusinessProfile';
import { openCall, openWhatsApp } from '../services/messaging';
import { ApiError } from '../services/api';
import { customersApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDate, formatMoney, titleCase } from '../utils/format';

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
    setLoading(true); setError(null);
    try {
      const result = await customersApi.get(route.params.customerId);
      setProfile(result); setName(result.customer.name); setPhone(result.customer.phone ?? ''); setEmail(result.customer.email ?? ''); setNotes(result.customer.notes ?? '');
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to load customer.'); }
    finally { setLoading(false); }
  }, [route.params.customerId]);
  useEffect(() => { void load(); }, [load]);
  const refreshTags = useCallback(() => { void customersApi.audiences().then(setAudiences).catch(() => setAudiences(null)); }, []);
  useEffect(() => { refreshTags(); }, [refreshTags]);

  const tabs = useMemo(() => (profile ? availableCommunicationTabs(profile.communicationTimeline) : ['all' as const]), [profile]);
  const timelineItems = useMemo(() => {
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
    setSaving(true); setError(null);
    try {
      await customersApi.patch(profile.customer.id, { name: name.trim(), phone: phone.trim() || undefined, email: email.trim() || undefined, notes: notes.trim() || undefined });
      setEditing(false); await load();
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to update customer.'); }
    finally { setSaving(false); }
  };

  if (loading && !profile) return <Screen><LoadingState label="Loading customer profile..." /></Screen>;
  if (error && !profile) return <Screen><ErrorState message={error} onRetry={() => void load()} /></Screen>;
  if (!profile) return <Screen><EmptyState title="Customer not found" message="This customer is no longer available." /></Screen>;
  const customer = profile.customer;
  const lastVisit = profile.reminders.map(item => item.lastVisitDate).filter((value): value is string => Boolean(value)).sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  const referralUrl = business?.publicSlug ? publicBusinessProfileUrl(business.publicSlug, customer.id) : null;
  const copyReferralUrl = async () => { if (!referralUrl) return; await Clipboard.setStringAsync(referralUrl); Alert.alert('Copied', `${customer.name}'s referral link was copied.`); };
  const shareReferralUrl = async () => { if (!referralUrl) return; try { await Share.share({ message: `${customer.name}, thanks for being a customer! Share this link with a friend: ${referralUrl}` }); } catch { /* user dismissed the share sheet */ } };

  const greeting = `Hi ${customer.name}, this is ${business?.name ?? 'us'}.`;
  const outstandingLead = profile.leads.find(item => item.status === 'won' && item.paymentStatus !== 'paid');
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

  return <>
    <Screen>
      <View style={styles.identity}><Avatar name={customer.name} /><AppHeader eyebrow="CUSTOMER" title={customer.name} subtitle={customer.phone ?? customer.email ?? 'No contact details'} right={<IconButton icon="create-outline" label="Edit customer" onPress={() => setEditing(true)} />} /></View>
      <Reveal delay={60}><View accessibilityLabel={`Lifetime value ${formatMoney(profile.lifetimeValue)}, ${profile.leads.length} leads, ${profile.reviewRequests.length} review requests`} style={styles.metrics}><View><Text style={styles.metricLabel}>LIFETIME VALUE</Text><Text style={styles.metricValue}>{formatMoney(profile.lifetimeValue)}</Text></View><View style={styles.metricDivider} /><View><Text style={styles.metricLabel}>LEADS</Text><Text style={styles.metricValue}>{profile.leads.length}</Text></View><View style={styles.metricDivider} /><View><Text style={styles.metricLabel}>REVIEWS</Text><Text style={styles.metricValue}>{profile.reviewRequests.length}</Text></View></View></Reveal>
      <View style={styles.profile}><InfoRow label="Email" value={customer.email ?? 'Not set'} /><InfoRow label="Phone" value={customer.phone ?? 'Not set'} /><InfoRow label="Last visit" value={lastVisit ? formatDate(lastVisit) : 'Not recorded'} /><InfoRow label="Notes" value={customer.notes ?? 'None'} /><InfoRow label="Customer since" value={formatDate(customer.createdAt)} /></View>
      {referralUrl ? <View style={styles.referralCard}>
        <Text style={styles.referralLabel}>Ask {customer.name} to refer a friend</Text>
        <View style={styles.referralActions}>
          <Pressable accessibilityRole="button" onPress={() => void copyReferralUrl()} style={styles.referralButton}><Text style={styles.referralButtonText}>Copy link</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => void shareReferralUrl()} style={[styles.referralButton, styles.referralButtonPrimary]}><Text style={[styles.referralButtonText, styles.referralButtonTextPrimary]}>Share</Text></Pressable>
        </View>
      </View> : null}

      {audiences ? <CustomerTags customerId={customer.id} data={audiences} onChanged={refreshTags} /> : null}
      {profile.communicationStatuses.length > 0 ? <View style={styles.statusRow}>{profile.communicationStatuses.map(status => <StatusBadge key={status} label={titleCase(status)} />)}</View> : null}

      {profile.assistantHighlight ? <View style={styles.assistantCard}>
        <Text style={styles.assistantEyebrow}>BUSINESS ASSISTANT</Text>
        <Text style={styles.assistantTitle}>{profile.assistantHighlight.title}</Text>
        <View style={styles.evidenceList}>{profile.assistantHighlight.evidence.map(line => <Text key={line} style={styles.assistantEvidence}>· {line}</Text>)}</View>
        <Text style={styles.assistantAction}>{profile.assistantHighlight.recommendedAction}</Text>
        <Pressable accessibilityRole="button" onPress={() => runQuickAction(profile.assistantHighlight!.quickAction)} style={styles.assistantButton}><Text style={styles.assistantButtonText}>{quickActionLabel(profile.assistantHighlight.quickAction)}</Text></Pressable>
      </View> : null}

      <View>
        <SectionHeader title="Quick actions" />
        <View style={styles.quickActions}>
          <SecondaryButton compact icon="calendar-outline" label="Schedule" onPress={() => runQuickAction('schedule')} />
          {customer.phone ? <SecondaryButton compact icon="call-outline" label="Call" onPress={() => runQuickAction('call')} /> : null}
          {customer.phone ? <SecondaryButton compact icon="logo-whatsapp" label="WhatsApp" onPress={() => runQuickAction('whatsapp')} /> : null}
          {showRequestReview ? <SecondaryButton compact icon="star-outline" label="Request review" onPress={() => runQuickAction('requestReview')} /> : null}
          {showCreateReminder ? <SecondaryButton compact icon="alarm-outline" label="Create reminder" onPress={() => runQuickAction('createReminder')} /> : null}
          {outstandingLead ? <SecondaryButton compact icon="cash-outline" label="Record payment" onPress={() => runQuickAction('recordPayment')} /> : null}
        </View>
      </View>

      <View><SectionHeader title="Appointments" action="Schedule" onAction={() => runQuickAction('schedule')} />{profile.appointments.length ? <View style={styles.appointmentList}>{profile.appointments.slice(0, 5).map(item => <Pressable key={item.id} accessibilityRole="button" onPress={() => navigation.navigate('AppointmentEditor', { appointmentId: item.id })} style={styles.appointmentRow}><View style={styles.activityIcon}><Text style={styles.appointmentDay}>{new Date(item.startsAt).getDate()}</Text></View><View style={styles.activityCopy}><Text style={styles.activityTitle}>{item.serviceName}</Text><Text style={styles.activityDetail}>{new Date(item.startsAt).toLocaleString()} · {titleCase(item.status)}</Text></View><StatusBadge label={titleCase(item.status)} /></Pressable>)}</View> : <Text style={styles.muted}>No appointments recorded for this customer.</Text>}</View>

      <View>
        <SectionHeader title="Communication timeline" />
        {tabs.length > 1 ? <FilterTabs options={tabs} value={tab} onChange={setTab} /> : null}
        {timelineItems.length ? <View style={styles.timeline}><Timeline items={timelineItems} /></View> : <EmptyState title="No communication yet" message="Every lead, message, review, reminder, and payment for this customer will show up here." />}
      </View>
    </Screen>
    <Modal visible={editing} transparent animationType="slide" onRequestClose={() => setEditing(false)}><Pressable style={styles.overlay} onPress={() => !saving && setEditing(false)}><Pressable style={styles.sheet} onPress={() => undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}><Text style={styles.sheetTitle}>Edit customer</Text><Field label="Name" value={name} onChangeText={setName} /><CountryPhoneInput value={phone} onChange={setPhone} /><Field label="Email" value={email} onChangeText={setEmail} /><Field label="Notes" value={notes} onChangeText={setNotes} />{error ? <Text style={styles.error}>{error}</Text> : null}<PrimaryButton disabled={saving || !name.trim()} fullWidth label={saving ? 'Saving...' : 'Save changes'} onPress={() => void save()} /></ScrollView></Pressable></Pressable></Modal>
  </>;
}

function quickActionLabel(kind: 'recordPayment' | 'createReminder' | 'requestReview'): string {
  return ({ recordPayment: 'Record payment', createReminder: 'Create reminder', requestReview: 'Request review' } as const)[kind];
}

function Field({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void }) { return <View><Text style={styles.fieldLabel}>{label}</Text><TextInput {...props} style={styles.input} /></View>; }
const styles = StyleSheet.create({
  identity: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }, metrics: { minHeight: 102, backgroundColor: colors.text, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, metricLabel: { ...typography.micro, color: colors.surface, marginBottom: spacing.xs }, metricValue: { ...typography.heading, color: colors.surface }, metricDivider: { width: 1, height: 48, backgroundColor: colors.textSecondary }, profile: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  referralCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, marginTop: spacing.md }, referralLabel: { ...typography.caption, color: colors.text }, referralActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }, referralButton: { minHeight: 40, flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.round }, referralButtonPrimary: { backgroundColor: colors.primary, borderColor: colors.primary }, referralButtonText: { ...typography.caption, color: colors.text, fontWeight: '700' }, referralButtonTextPrimary: { color: colors.surface },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  assistantCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.primary, padding: spacing.md, gap: spacing.xs },
  assistantEyebrow: { ...typography.micro, color: colors.primary, letterSpacing: 0.5 },
  assistantTitle: { ...typography.bodyStrong, color: colors.text },
  evidenceList: { gap: 2 },
  assistantEvidence: { ...typography.caption, color: colors.textSecondary },
  assistantAction: { ...typography.caption, color: colors.text, fontStyle: 'italic' },
  assistantButton: { minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.round, borderWidth: 1, borderColor: colors.primary, marginTop: spacing.xxs },
  assistantButtonText: { ...typography.caption, color: colors.primary, fontWeight: '700' },
  quickActions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  appointmentList: { marginTop: spacing.sm }, appointmentRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider }, appointmentDay: { ...typography.bodyStrong, color: colors.primary }, activityIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft }, activityCopy: { flex: 1 }, activityTitle: { ...typography.bodyStrong, color: colors.text }, activityDetail: { ...typography.caption, color: colors.textSecondary }, muted: { ...typography.body, color: colors.textSecondary, marginTop: spacing.sm },
  timeline: { marginTop: spacing.md },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }, sheet: { maxHeight: '92%', backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }, sheetContent: { padding: spacing.xl, paddingBottom: 40, gap: spacing.md }, sheetTitle: { ...typography.heading, color: colors.text }, fieldLabel: { ...typography.caption, color: colors.text, marginBottom: spacing.xs }, input: { minHeight: 48, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, ...typography.body, color: colors.text }, error: { ...typography.caption, color: colors.negative }
});
