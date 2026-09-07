import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { CountryPhoneInput } from '../components/CountryPhoneInput';
import { LeadDto, LeadStatus } from '../apiTypes';
import { ApiError } from '../services/api';
import { customersApi, leadsApi } from '../services/endpoints';
import { useAppState } from '../state/AppContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { colors, radius, spacing, typography } from '../theme';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { MainTabParamList, RootStackParamList } from '../types';
import { titleCase } from '../utils/format';

const filters = ['all', 'new', 'contacted', 'booked', 'won', 'lost'] as const;
type Filter = (typeof filters)[number];

const CHANNEL: Record<string, { label: string; icon: string }> = {
  missed_call: { label: 'Missed call', icon: 'phone_missed' },
  whatsapp: { label: 'WhatsApp', icon: 'forum' },
  website: { label: 'Website form', icon: 'language' },
  public_profile: { label: 'Profile enquiry', icon: 'storefront' },
  referral: { label: 'Referral', icon: 'diversity_1' },
};

function channelFor(source: string | null) {
  return (source && CHANNEL[source]) || { label: source ? titleCase(source) : 'Enquiry', icon: 'chat' };
}
function relative(iso: string | null) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}
function initials(name: string | null | undefined) {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

export function LeadsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, 'Leads'>>();
  const { leads, leadTotal, leadPage, customers, state, loadLeads, loadCustomers } = useAppState();
  const { refresh: refreshPlan } = usePlanExperience();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [callerMode, setCallerMode] = useState<'existing' | 'new'>('existing');
  const [customerId, setCustomerId] = useState('');
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [service, setService] = useState('');
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');
  const [urgency, setUrgency] = useState<'low' | 'medium' | 'high'>('medium');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => { void loadLeads(filter === 'all' ? undefined : filter); }, [filter, loadLeads]);
  useEffect(() => { if (!state.customers.loaded) void loadCustomers(); }, [loadCustomers, state.customers.loaded]);
  useEffect(() => {
    const presetId = route.params?.presetCustomerId;
    if (presetId) { setCustomerId(presetId); setCallerMode('existing'); setCreating(true); }
  }, [route.params?.presetCustomerId]);

  const visible = useMemo(
    () => leads.filter((lead) => `${lead.customer?.name ?? ''} ${lead.serviceRequested ?? ''}`.toLowerCase().includes(search.toLowerCase())),
    [leads, search],
  );
  const previousSearch = useRef(search);
  useEffect(() => {
    if (previousSearch.current === search) return;
    previousSearch.current = search;
    if (leadPage > 1) void loadLeads(filter === 'all' ? undefined : filter);
  }, [filter, leadPage, loadLeads, search]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const l of leads) out[l.status] = (out[l.status] ?? 0) + 1;
    return out;
  }, [leads]);
  const newCount = counts.new ?? 0;

  const create = async () => {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      let selectedCustomerId = customerId || undefined;
      if (callerMode === 'new') {
        const customer = await customersApi.create({ name: callerName.trim(), phone: callerPhone });
        selectedCustomerId = customer.id;
        await loadCustomers();
      }
      const lead = await leadsApi.create({
        customerId: selectedCustomerId,
        source: 'missed_call',
        missedCallTime: new Date().toISOString(),
        serviceRequested: service.trim() || undefined,
        urgency,
        estimatedValue: value ? Number(value) : undefined,
        notes: notes.trim() || undefined,
      });
      void refreshPlan();
      setCreating(false);
      setService(''); setValue(''); setNotes(''); setCallerName(''); setCallerPhone('');
      await loadLeads(filter === 'all' ? undefined : filter);
      navigation.navigate('LeadDetail', { leadId: lead.id });
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Unable to create lead.');
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <M3Header
      businessName="Leads"
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      onAvatarPress={() => navigation.navigate('Main', { screen: 'Settings' })}
      hasNotifications={newCount > 0}
    />
  );

  const renderLead = (lead: LeadDto) => {
    const channel = channelFor(lead.source);
    const urgent = lead.urgency === 'high';
    return (
      <M3Card key={lead.id} onPress={() => navigation.navigate('LeadDetail', { leadId: lead.id })} style={styles.leadCard}>
        <View style={styles.leadTop}>
          <View style={styles.leadClientRow}>
            <View style={styles.leadAvatar}>
              <Text style={styles.leadAvatarText}>{initials(lead.customer?.name)}</Text>
            </View>
            <View style={styles.flex}>
              <View style={styles.leadNameRow}>
                <Text numberOfLines={1} style={styles.leadName}>
                  {lead.customer?.name ?? 'Unassigned lead'}
                </Text>
                {urgent ? <Chip label="Urgent" tone="primaryFixed" /> : null}
              </View>
              <Text numberOfLines={1} style={styles.leadService}>
                {lead.serviceRequested ?? 'Service not specified'}
              </Text>
            </View>
          </View>
          <Chip
            label={titleCase(lead.status)}
            tone={lead.status === 'won' ? 'secondary' : lead.status === 'lost' ? 'error' : 'neutral'}
          />
        </View>

        <View style={styles.leadChannel}>
          <Icon name={channel.icon} size={15} color={m3.secondary} />
          <Text style={styles.leadChannelText}>
            {channel.label}
            {lead.missedCallTime ? ` · ${relative(lead.missedCallTime)}` : ''}
          </Text>
        </View>

        {lead.generatedReply ? (
          <View style={styles.leadAiBox}>
            <Icon name="smart_toy" size={16} color={m3.secondary} />
            <Text numberOfLines={2} style={styles.leadAiText}>
              {lead.generatedReply}
            </Text>
          </View>
        ) : null}

        <View style={styles.leadActions}>
          <View style={styles.leadActionGhost}>
            <Icon name="call" size={16} color={m3.onSurface} />
            <Text style={styles.leadActionGhostText}>Call</Text>
          </View>
          <View style={styles.leadActionGhost}>
            <Icon name="chat" size={16} color={m3.onSurface} />
            <Text style={styles.leadActionGhostText}>Message</Text>
          </View>
          <View style={styles.leadActionPrimary}>
            <Icon name="event_available" size={16} color={m3.onPrimary} />
            <Text style={styles.leadActionPrimaryText}>Convert</Text>
          </View>
        </View>
      </M3Card>
    );
  };

  const loadingList = !state.leads.loaded && state.leads.loading;

  return (
    <>
      <M3Screen header={header}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <Text style={styles.title}>Leads & Enquiries</Text>
            <View style={styles.titleMetaRow}>
              <View style={styles.pulseDot} />
              <Text style={styles.titleMeta}>
                {newCount ? `${newCount} new lead${newCount === 1 ? '' : 's'} to follow up` : `${leadTotal} lead${leadTotal === 1 ? '' : 's'} total`}
              </Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={styles.addBtn}>
            <Icon name="add" size={18} color={m3.onPrimary} />
            <Text style={styles.addText}>Add Lead</Text>
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <Icon name="search" size={18} color={m3.outline} style={styles.searchIcon} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search leads, phone, tags…"
            placeholderTextColor={m3.outline}
            style={styles.searchInput}
          />
        </View>

        <View style={styles.chipsWrap}>
          {filters.map((f) => (
            <Chip
              key={f}
              label={f === 'all' ? 'All' : titleCase(f)}
              selected={filter === f}
              count={f === 'all' ? leadTotal : counts[f] ?? 0}
              onPress={() => setFilter(f)}
            />
          ))}
        </View>

        {loadingList ? (
          <M3Loading label="Loading leads…" />
        ) : state.leads.error ? (
          <M3Error message={state.leads.error} onRetry={() => void loadLeads(filter === 'all' ? undefined : filter)} />
        ) : visible.length ? (
          <View style={styles.list}>{visible.map(renderLead)}</View>
        ) : (
          <M3Empty
            icon="person_add"
            title={search ? 'No leads found' : 'No leads here'}
            message={search ? 'Try a different search.' : 'Add a missed-call lead to begin follow-up.'}
          />
        )}

        {leads.length < leadTotal ? (
          <Pressable
            accessibilityRole="button"
            disabled={state.leads.loading}
            onPress={() => void loadLeads(filter === 'all' ? undefined : filter, leadPage + 1, true)}
            style={styles.loadMore}
          >
            <Text style={styles.loadMoreText}>{state.leads.loading ? 'Loading…' : 'Load more leads'}</Text>
          </Pressable>
        ) : null}
      </M3Screen>

      <Modal visible={creating} transparent animationType="slide" onRequestClose={() => setCreating(false)}>
        <Pressable style={styles.overlay} onPress={() => !saving && setCreating(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>Missed-call lead</Text>
            <View style={styles.segment}>
              <Pressable onPress={() => setCallerMode('existing')} style={[styles.segmentItem, callerMode === 'existing' && styles.segmentActive]}>
                <Text style={[styles.segmentText, callerMode === 'existing' && styles.segmentTextActive]}>Existing customer</Text>
              </Pressable>
              <Pressable onPress={() => setCallerMode('new')} style={[styles.segmentItem, callerMode === 'new' && styles.segmentActive]}>
                <Text style={[styles.segmentText, callerMode === 'new' && styles.segmentTextActive]}>New caller</Text>
              </Pressable>
            </View>
            {callerMode === 'existing' ? (
              <>
                <Text style={styles.label}>Customer</Text>
                <View style={styles.choices}>
                  {customers.map((customer) => (
                    <Pressable key={customer.id} onPress={() => setCustomerId(customer.id)} style={[styles.choice, customerId === customer.id && styles.choiceActive]}>
                      <Text style={[styles.choiceText, customerId === customer.id && styles.choiceTextActive]}>{customer.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : (
              <>
                <Field label="Caller name" value={callerName} onChangeText={setCallerName} />
                <CountryPhoneInput value={callerPhone} onChange={setCallerPhone} label="Caller phone" />
              </>
            )}
            <Field label="Service requested" value={service} onChangeText={setService} />
            <Field label="Estimated value" value={value} onChangeText={setValue} keyboardType="decimal-pad" />
            <Field label="Notes" value={notes} onChangeText={setNotes} />
            <Text style={styles.label}>Urgency</Text>
            <View style={styles.choices}>
              {(['low', 'medium', 'high'] as const).map((item) => (
                <Pressable key={item} onPress={() => setUrgency(item)} style={[styles.choice, urgency === item && styles.choiceActive]}>
                  <Text style={[styles.choiceText, urgency === item && styles.choiceTextActive]}>{titleCase(item)}</Text>
                </Pressable>
              ))}
            </View>
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <PrimaryButton
              disabled={saving || (callerMode === 'existing' ? !customerId : !callerName.trim() || callerPhone.length < 7)}
              fullWidth
              label={saving ? 'Creating…' : 'Create lead'}
              onPress={() => void create()}
            />
            <SecondaryButton disabled={saving} fullWidth label="Cancel" onPress={() => setCreating(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function Field({ label, ...props }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: 'decimal-pad' }) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput {...props} style={styles.input} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  list: { gap: m3Space.sm },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  titleMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  pulseDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: m3.primary },
  titleMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 38, paddingHorizontal: 12, borderRadius: m3Radius.sm, backgroundColor: m3.primary },
  addText: { ...m3Type.labelMd, color: m3.onPrimary },

  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.md, paddingHorizontal: 12, height: 44 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, ...m3Type.bodyMd, color: m3.onSurface, padding: 0 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },

  loadMore: { height: 44, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  loadMoreText: { ...m3Type.labelMd, color: m3.onSurface },

  leadCard: { gap: 10 },
  leadTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.xs },
  leadClientRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  leadAvatar: { width: 44, height: 44, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  leadAvatarText: { ...m3Type.labelMd, color: m3.primary },
  leadNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  leadName: { ...m3Type.headlineSm, fontSize: 17, color: m3.onSurface, flexShrink: 1 },
  leadService: { ...m3Type.labelMd, color: m3.primary, marginTop: 1 },
  leadChannel: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(134,242,228,0.35)', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 5, borderRadius: m3Radius.sm },
  leadChannelText: { ...m3Type.labelSm, color: m3.onSecondaryContainer, letterSpacing: 0 },
  leadAiBox: { flexDirection: 'row', gap: 8, backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.sm, padding: 10 },
  leadAiText: { ...m3Type.bodySm, color: m3.onSurface, flex: 1 },
  leadActions: { flexDirection: 'row', gap: m3Space.xs },
  leadActionGhost: { flex: 1, height: 36, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainerLow, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  leadActionGhostText: { ...m3Type.labelMd, color: m3.onSurface },
  leadActionPrimary: { flex: 1, height: 36, borderRadius: m3Radius.sm, backgroundColor: m3.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  leadActionPrimaryText: { ...m3Type.labelMd, color: m3.onPrimary },

  // --- create sheet (kept from the prior screen, retinted) ---
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { maxHeight: '94%', backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 40, gap: spacing.md },
  sheetTitle: { ...typography.heading, color: colors.text },
  label: { ...typography.caption, color: colors.text },
  input: { minHeight: 48, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, ...typography.body, color: colors.text },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  choice: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.sm, borderRadius: radius.round, borderWidth: 1, borderColor: colors.border },
  choiceActive: { borderColor: colors.primary },
  choiceText: { ...typography.caption, color: colors.textSecondary },
  choiceTextActive: { color: colors.primary, fontWeight: '700' },
  error: { ...typography.caption, color: colors.negative },
  segment: { height: 44, flexDirection: 'row', padding: 3, borderRadius: radius.md, backgroundColor: colors.background },
  segmentItem: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  segmentText: { ...typography.caption, color: colors.textSecondary },
  segmentTextActive: { color: colors.text, fontWeight: '700' },
});
