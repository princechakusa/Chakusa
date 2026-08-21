import { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { CustomerProfileDto } from '../apiTypes';
import { AppHeader, Avatar, EmptyState, ErrorState, IconButton, InfoRow, LoadingState, PrimaryButton, Reveal, Screen, SecondaryButton, SectionHeader, Timeline } from '../components/ui';
import { CountryPhoneInput } from '../components/CountryPhoneInput';
import { publicBusinessProfileUrl } from '../domain/publicBusinessProfile';
import { ApiError } from '../services/api';
import { customersApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList, TimelineItem } from '../types';
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

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await customersApi.get(route.params.customerId);
      setProfile(result); setName(result.customer.name); setPhone(result.customer.phone ?? ''); setEmail(result.customer.email ?? ''); setNotes(result.customer.notes ?? '');
    } catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Unable to load customer.'); }
    finally { setLoading(false); }
  }, [route.params.customerId]);
  useEffect(() => { void load(); }, [load]);

  const timeline = useMemo<TimelineItem[]>(() => {
    if (!profile) return [];
    const rows: Array<{ id: string; at: string; title: string; detail: string; value?: string; tone?: TimelineItem['tone'] }> = [
      ...profile.activity.map(item => ({ id: `activity-${item.id}`, at: item.createdAt, title: titleCase(item.eventType), detail: titleCase(item.entityType) })),
      ...profile.leads.map(item => ({ id: `lead-${item.id}`, at: item.updatedAt, title: `Lead ${titleCase(item.status)}`, detail: item.serviceRequested ?? 'Missed-call lead', value: item.status === 'won' ? formatMoney(item.estimatedValue) : undefined, tone: item.status === 'won' ? 'success' as const : 'default' as const })),
      ...profile.reviewRequests.map(item => ({ id: `review-${item.id}`, at: item.updatedAt, title: `Review ${titleCase(item.status)}`, detail: item.serviceName ?? 'Review request' })),
      ...profile.feedback.map(item => ({ id: `feedback-${item.id}`, at: item.createdAt, title: 'Private feedback received', detail: `${item.rating}/5 · ${titleCase(item.sentiment ?? 'new')}` })),
      ...profile.reminders.map(item => ({ id: `reminder-${item.id}`, at: item.updatedAt, title: `Reminder ${titleCase(item.status)}`, detail: item.serviceName ?? 'Comeback reminder', tone: item.status === 'completed' ? 'success' as const : 'attention' as const })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return rows.map(item => ({ id: item.id, date: formatDate(item.at, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase(), title: item.title, detail: item.detail, value: item.value, tone: item.tone }));
  }, [profile]);

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
      <HistorySection title="Lead history" empty="No leads for this customer." action={!profile.leads.length ? { label: 'Create a lead', onPress: () => navigation.navigate('Main', { screen: 'Leads', params: { presetCustomerId: customer.id } }) } : undefined}>{profile.leads.map(item => <HistoryRow key={item.id} title={item.serviceRequested ?? 'Missed-call lead'} detail={`${titleCase(item.status)} · ${formatDate(item.updatedAt)}`} onPress={() => navigation.navigate('LeadDetail', { leadId: item.id })} />)}</HistorySection>
      <HistorySection title="Review history" empty="No review requests for this customer." action={!profile.reviewRequests.length ? { label: 'Request a review', onPress: () => navigation.navigate('Main', { screen: 'Reviews', params: { presetCustomerId: customer.id } }) } : undefined}>{profile.reviewRequests.map(item => <HistoryRow key={item.id} title={item.serviceName ?? 'Review request'} detail={`${titleCase(item.status)} · ${formatDate(item.updatedAt)}`} onPress={() => navigation.navigate('ReviewDetail', { reviewId: item.id })} />)}</HistorySection>
      <HistorySection title="Comeback reminders" empty="No comeback reminders for this customer." action={!profile.reminders.length ? { label: 'Set a reminder', onPress: () => navigation.navigate('Comeback', { presetCustomerId: customer.id }) } : undefined}>{profile.reminders.map(item => <HistoryRow key={item.id} title={item.serviceName ?? 'Comeback reminder'} detail={`${titleCase(item.status)} · Due ${formatDate(item.dueDate)}`} onPress={() => navigation.navigate('Comeback')} />)}</HistorySection>
      <View><SectionHeader title="Activity timeline" />{timeline.length ? <View style={styles.timeline}><Timeline items={timeline} /></View> : <EmptyState title="No customer activity" message="Activity will appear as this relationship grows." />}</View>
    </Screen>
    <Modal visible={editing} transparent animationType="slide" onRequestClose={() => setEditing(false)}><Pressable style={styles.overlay} onPress={() => !saving && setEditing(false)}><Pressable style={styles.sheet} onPress={() => undefined}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}><Text style={styles.sheetTitle}>Edit customer</Text><Field label="Name" value={name} onChangeText={setName} /><CountryPhoneInput value={phone} onChange={setPhone} /><Field label="Email" value={email} onChangeText={setEmail} /><Field label="Notes" value={notes} onChangeText={setNotes} />{error ? <Text style={styles.error}>{error}</Text> : null}<PrimaryButton disabled={saving || !name.trim()} fullWidth label={saving ? 'Saving...' : 'Save changes'} onPress={() => void save()} /></ScrollView></Pressable></Pressable></Modal>
  </>;
}

function HistorySection({ title, empty, action, children }: { title: string; empty: string; action?: { label: string; onPress: () => void }; children: React.ReactNode[] }) {
  return <View><SectionHeader title={title} />{children.length ? <View style={styles.history}>{children}</View> : <View style={styles.historyEmptyRow}><Text style={styles.historyEmpty}>{empty}</Text>{action ? <SecondaryButton compact label={action.label} onPress={action.onPress} /> : null}</View>}</View>;
}
function HistoryRow({ title, detail, onPress }: { title: string; detail: string; onPress: () => void }) { return <Pressable onPress={onPress} style={styles.historyRow}><View style={styles.historyCopy}><Text style={styles.historyTitle}>{title}</Text><Text style={styles.historyDetail}>{detail}</Text></View><Text style={styles.historyAction}>View</Text></Pressable>; }
function Field({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void }) { return <View><Text style={styles.fieldLabel}>{label}</Text><TextInput {...props} style={styles.input} /></View>; }
const styles = StyleSheet.create({
  identity: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }, metrics: { minHeight: 102, backgroundColor: colors.text, borderRadius: radius.md, padding: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, metricLabel: { ...typography.micro, color: colors.surface, marginBottom: spacing.xs }, metricValue: { ...typography.heading, color: colors.surface }, metricDivider: { width: 1, height: 48, backgroundColor: colors.textSecondary }, profile: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  referralCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, marginTop: spacing.md }, referralLabel: { ...typography.caption, color: colors.text }, referralActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs }, referralButton: { minHeight: 40, flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: radius.round }, referralButtonPrimary: { backgroundColor: colors.primary, borderColor: colors.primary }, referralButtonText: { ...typography.caption, color: colors.text, fontWeight: '700' }, referralButtonTextPrimary: { color: colors.surface },
  history: { marginTop: spacing.xs, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md }, historyRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider }, historyCopy: { flex: 1 }, historyTitle: { ...typography.bodyStrong, color: colors.text }, historyDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 }, historyAction: { ...typography.caption, color: colors.primary, fontWeight: '700' }, historyEmpty: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs, flex: 1 }, historyEmptyRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xs }, timeline: { marginTop: spacing.md },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' }, sheet: { maxHeight: '92%', backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl }, sheetContent: { padding: spacing.xl, paddingBottom: 40, gap: spacing.md }, sheetTitle: { ...typography.heading, color: colors.text }, fieldLabel: { ...typography.caption, color: colors.text, marginBottom: spacing.xs }, input: { minHeight: 48, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, ...typography.body, color: colors.text }, error: { ...typography.caption, color: colors.negative }
});
