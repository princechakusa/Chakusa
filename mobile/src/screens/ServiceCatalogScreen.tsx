import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ServiceOfferingDto, TeamMemberDto } from '../apiTypes';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { ApiError } from '../services/api';
import { ServiceOfferingInput, servicesApi, teamApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { useAuth } from '../state/AuthContext';
import { RootStackParamList } from '../types';
import { formatMoney } from '../utils/format';

interface Draft { name: string; description: string; category: string; sortOrder: string; duration: string; preparation: string; cleanup: string; price: string; deposit: string; active: boolean; publiclyBookable: boolean; memberIds: string[] }
const blank: Draft = { name: '', description: '', category: '', sortOrder: '0', duration: '60', preparation: '0', cleanup: '0', price: '', deposit: '', active: true, publiclyBookable: true, memberIds: [] };
const toDraft = (service: ServiceOfferingDto): Draft => ({
  name: service.name,
  description: service.description ?? '',
  category: service.category ?? '',
  sortOrder: String(service.sortOrder),
  duration: String(service.durationMinutes),
  preparation: String(service.preparationMinutes),
  cleanup: String(service.cleanupMinutes),
  price: service.price == null ? '' : String(service.price),
  deposit: service.depositAmount == null ? '' : String(service.depositAmount),
  active: service.active,
  publiclyBookable: service.publiclyBookable,
  memberIds: service.assignments.map((item) => item.businessMemberId),
});
const draftToInput = (draft: Draft): ServiceOfferingInput => ({
  name: draft.name.trim(),
  description: draft.description.trim() || null,
  category: draft.category.trim() || null,
  sortOrder: Number(draft.sortOrder),
  durationMinutes: Number(draft.duration),
  preparationMinutes: Number(draft.preparation),
  cleanupMinutes: Number(draft.cleanup),
  price: draft.price ? Number(draft.price) : null,
  depositAmount: draft.deposit ? Number(draft.deposit) : null,
  active: draft.active,
  publiclyBookable: draft.publiclyBookable,
  memberIds: draft.memberIds,
});

export function ServiceCatalogScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { business, role } = useAuth();
  const [services, setServices] = useState<ServiceOfferingDto[]>([]);
  const [members, setMembers] = useState<TeamMemberDto[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ServiceOfferingDto | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const canEdit = role === 'OWNER' || role === 'ADMIN';

  const load = useCallback(async () => {
    try {
      const [catalog, team] = await Promise.all([servicesApi.list(), teamApi.listMembers()]);
      setServices(catalog);
      setMembers(team.filter((member) => member.status === 'ACTIVE'));
      setError(null);
    } catch {
      setError('Could not load your service catalog.');
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = (service?: ServiceOfferingDto) => {
    setDraft(service ? toDraft(service) : blank);
    setEditing(service ?? 'new');
    setError(null);
  };
  const valid =
    draft.name.trim() &&
    Number(draft.sortOrder) >= 0 &&
    Number(draft.duration) >= 5 &&
    Number(draft.preparation) >= 0 &&
    Number(draft.cleanup) >= 0 &&
    (!draft.price || Number(draft.price) >= 0) &&
    (!draft.deposit || Number(draft.deposit) >= 0) &&
    (!draft.price || !draft.deposit || Number(draft.deposit) <= Number(draft.price));
  const save = async () => {
    if (!valid || saving || !editing) return;
    setSaving(true);
    setError(null);
    try {
      if (editing === 'new') await servicesApi.create(draftToInput(draft));
      else await servicesApi.patch(editing.id, draftToInput(draft));
      setEditing(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save this service.');
    } finally {
      setSaving(false);
    }
  };
  const archive = (service: ServiceOfferingDto) =>
    Alert.alert('Archive this service?', 'Existing appointments keep their service details. Customers will no longer be able to book it.', [
      { text: 'Keep service', style: 'cancel' },
      { text: 'Archive', style: 'destructive', onPress: () => void servicesApi.archive(service.id).then(load).catch(() => Alert.alert('Could not archive service', 'Please try again.')) },
    ]);
  const toggleMember = (id: string) =>
    setDraft((current) => ({ ...current, memberIds: current.memberIds.includes(id) ? current.memberIds.filter((value) => value !== id) : [...current.memberIds, id] }));
  const togglePublic = async (service: ServiceOfferingDto) => {
    if (togglingId) return;
    setTogglingId(service.id);
    try {
      await servicesApi.patch(service.id, draftToInput({ ...toDraft(service), publiclyBookable: !service.publiclyBookable }));
      await load();
    } catch {
      Alert.alert('Could not update booking status', 'Please try again.');
    } finally {
      setTogglingId(null);
    }
  };

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const service of services) counts.set(service.category?.trim() || 'Uncategorized', (counts.get(service.category?.trim() || 'Uncategorized') ?? 0) + 1);
    return Array.from(counts.entries());
  }, [services]);
  const visible = useMemo(() => (category ? services.filter((service) => (service.category?.trim() || 'Uncategorized') === category) : services), [services, category]);
  const activeCount = services.filter((service) => service.active).length;
  const avgBuffer = services.length ? Math.round(services.reduce((sum, service) => sum + service.preparationMinutes + service.cleanupMinutes, 0) / services.length) : 0;

  const header = (
    <M3Header businessName="Services" onBack={() => navigation.goBack()} />
  );

  const memberNames = (service: ServiceOfferingDto) =>
    service.assignments.length
      ? service.assignments.map((item) => item.businessMember.user.fullName).join(', ')
      : 'Every active team member';

  return (
    <>
      <M3Screen header={header}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <Text style={styles.eyebrow}>BUSINESS SETUP</Text>
            <Text style={styles.title}>Services</Text>
          </View>
          {canEdit ? (
            <Pressable accessibilityRole="button" onPress={() => open()} style={styles.addBtn}>
              <Icon name="add" size={18} color={m3.onPrimary} />
              <Text style={styles.addText}>Add Service</Text>
            </Pressable>
          ) : null}
        </View>
        <Text style={styles.subtitle}>Control duration, pricing, booking availability, and who can provide each service.</Text>

        {loaded && services.length ? (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={styles.statTop}>
                <Text style={styles.statLabel}>ACTIVE SERVICES</Text>
                <Icon name="tune" size={18} color={m3.secondary} />
              </View>
              <View style={styles.statValueRow}>
                <Text style={styles.statValue}>{activeCount}</Text>
                <Text style={styles.statBadge}>{services.length ? `${Math.round((activeCount / services.length) * 100)}% active` : ''}</Text>
              </View>
              <View style={styles.statBar}>
                <View style={[styles.statBarFill, { width: `${services.length ? Math.round((activeCount / services.length) * 100) : 0}%` }]} />
              </View>
            </View>
            <View style={styles.statCard}>
              <View style={styles.statTop}>
                <Text style={styles.statLabel}>AVG. SERVICE BUFFER</Text>
                <Icon name="hourglass_top" size={18} color={m3.tertiary} />
              </View>
              <View style={styles.statValueRow}>
                <Text style={styles.statValue}>{avgBuffer}</Text>
                <Text style={styles.statUnit}>min</Text>
              </View>
              <Text style={styles.statCaption}>Prep + cleanup, averaged</Text>
            </View>
          </View>
        ) : null}

        {categories.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsWrap}>
            <Chip label="All" selected={!category} count={services.length} onPress={() => setCategory(null)} style={styles.chipSpacing} />
            {categories.map(([name, count]) => (
              <Chip key={name} label={name} selected={category === name} count={count} onPress={() => setCategory(name)} style={styles.chipSpacing} />
            ))}
          </ScrollView>
        ) : null}

        {!loaded ? (
          <M3Loading label="Loading services…" />
        ) : error && !services.length ? (
          <M3Error message={error} onRetry={() => void load()} />
        ) : !services.length ? (
          <M3Empty icon="sell" title="Add your first service" message="Services power availability, public booking, calendar timing, and deposits." />
        ) : (
          <View style={styles.list}>
            {visible.map((service) => (
              <M3Card key={service.id} style={styles.serviceCard}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={canEdit ? `Edit ${service.name}` : service.name}
                  disabled={!canEdit}
                  onPress={() => open(service)}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <View style={styles.serviceTop}>
                    <View style={styles.serviceIcon}>
                      <Icon name="sell" size={20} color={m3.primary} />
                    </View>
                    <View style={styles.flex}>
                      <View style={styles.serviceNameRow}>
                        <Text numberOfLines={1} style={styles.serviceName}>{service.name}</Text>
                        <Text style={styles.servicePrice}>{service.price == null ? '—' : formatMoney(service.price, business?.currency ?? 'USD')}</Text>
                      </View>
                      {service.description ? (
                        <Text numberOfLines={1} style={styles.serviceDesc}>{service.description}</Text>
                      ) : null}
                      <View style={styles.serviceMetaRow}>
                        <View style={styles.serviceMetaItem}>
                          <Icon name="schedule" size={15} color={m3.tertiary} />
                          <Text style={styles.serviceMetaText}>{service.durationMinutes} mins</Text>
                        </View>
                        {service.preparationMinutes || service.cleanupMinutes ? (
                          <View style={styles.serviceMetaItem}>
                            <Icon name="clean_hands" size={15} color={m3.secondary} />
                            <Text style={[styles.serviceMetaText, { color: m3.secondary }]}>
                              {service.preparationMinutes + service.cleanupMinutes} min buffer
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </View>
                  <View style={styles.assignedRow}>
                    <Icon name="group" size={16} color={m3.onSurfaceVariant} />
                    <Text numberOfLines={1} style={styles.assignedLabel}>Team:</Text>
                    <Text numberOfLines={1} style={styles.assignedValue}>{memberNames(service)}</Text>
                  </View>
                </Pressable>

                <View style={styles.serviceFooter}>
                  <View style={styles.toggleRow}>
                    <Switch
                      accessibilityLabel={`Online booking for ${service.name}`}
                      disabled={!canEdit || togglingId === service.id || !service.active}
                      value={service.publiclyBookable}
                      onValueChange={() => void togglePublic(service)}
                      trackColor={{ false: m3.surfaceContainerHighest, true: m3.secondary }}
                      thumbColor={m3.surfaceContainerLowest}
                    />
                    <Text style={styles.toggleLabel}>
                      {!service.active ? 'Archived' : service.publiclyBookable ? 'Online Booking Active' : 'Online Booking Paused'}
                    </Text>
                  </View>
                  {canEdit ? (
                    <View style={styles.footerActions}>
                      <Pressable accessibilityRole="button" onPress={() => open(service)} style={styles.editBtn}>
                        <Icon name="edit" size={15} color={m3.onSurface} />
                        <Text style={styles.editBtnText}>Edit Details</Text>
                      </Pressable>
                      <Pressable accessibilityRole="button" onPress={() => archive(service)} style={styles.archiveBtn}>
                        <Icon name="archive" size={16} color={m3.onSurfaceVariant} />
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              </M3Card>
            ))}
          </View>
        )}
      </M3Screen>

      <Modal visible={Boolean(editing)} transparent animationType="slide" onRequestClose={() => !saving && setEditing(null)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>{editing === 'new' ? 'New service' : 'Edit service'}</Text>
              <Text style={styles.label}>Service name</Text>
              <TextInput accessibilityLabel="Service name" value={draft.name} onChangeText={(name) => setDraft((current) => ({ ...current, name }))} style={styles.input} />
              <Text style={styles.label}>Description</Text>
              <TextInput accessibilityLabel="Service description" multiline value={draft.description} onChangeText={(description) => setDraft((current) => ({ ...current, description }))} style={[styles.input, styles.multiline]} />
              <Text style={styles.label}>Category</Text>
              <TextInput accessibilityLabel="Service category" placeholder="e.g. Hair, Nails, Consulting" value={draft.category} onChangeText={(cat) => setDraft((current) => ({ ...current, category: cat }))} style={styles.input} />
              <View style={styles.fields}>
                <NumberField label="Display order" value={draft.sortOrder} onChange={(sortOrder) => setDraft((current) => ({ ...current, sortOrder }))} />
                <NumberField label="Duration (min)" value={draft.duration} onChange={(duration) => setDraft((current) => ({ ...current, duration }))} />
                <NumberField label="Price" value={draft.price} onChange={(price) => setDraft((current) => ({ ...current, price }))} />
                <NumberField label="Deposit" value={draft.deposit} onChange={(deposit) => setDraft((current) => ({ ...current, deposit }))} />
                <NumberField label="Preparation" value={draft.preparation} onChange={(preparation) => setDraft((current) => ({ ...current, preparation }))} />
                <NumberField label="Cleanup" value={draft.cleanup} onChange={(cleanup) => setDraft((current) => ({ ...current, cleanup }))} />
              </View>
              <Toggle label="Active" detail="Available for internal scheduling" value={draft.active} onChange={(active) => setDraft((current) => ({ ...current, active }))} />
              <Toggle label="Public booking" detail="Customers can select this service" value={draft.publiclyBookable} onChange={(publiclyBookable) => setDraft((current) => ({ ...current, publiclyBookable }))} />
              <Text style={styles.label}>Team members</Text>
              <Text style={styles.helper}>Leave everyone unselected to make this service available with every active member.</Text>
              <View style={styles.members}>
                {members.map((member) => {
                  const selected = draft.memberIds.includes(member.id);
                  return (
                    <Pressable key={member.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => toggleMember(member.id)} style={[styles.member, selected && styles.memberSelected]}>
                      <Text style={styles.memberText}>{member.name}</Text>
                      <Icon name={selected ? 'check_circle' : 'radio_button_unchecked'} size={18} color={selected ? m3.secondary : m3.outline} />
                    </Pressable>
                  );
                })}
              </View>
              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
              <PrimaryButton fullWidth disabled={!valid || saving} label={saving ? 'Saving…' : 'Save service'} onPress={() => void save()} />
              <SecondaryButton fullWidth disabled={saving} label="Cancel" onPress={() => setEditing(null)} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <View style={styles.numberField}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} keyboardType="decimal-pad" value={value} onChangeText={onChange} style={styles.input} />
    </View>
  );
}
function Toggle({ label, detail, value, onChange }: { label: string; detail: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.toggle}>
      <View style={styles.flex}>
        <Text style={styles.toggleName}>{label}</Text>
        <Text style={styles.toggleDetail}>{detail}</Text>
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ false: colors.border, true: colors.success }} thumbColor={colors.surface} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  list: { gap: m3Space.sm },
  pressed: { opacity: 0.85 },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm },
  eyebrow: { ...m3Type.labelSm, color: m3.secondary, letterSpacing: 0.6 },
  title: { ...m3Type.headlineMd, color: m3.onSurface, marginTop: 2 },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 38, paddingHorizontal: 12, borderRadius: m3Radius.md, backgroundColor: m3.primary },
  addText: { ...m3Type.labelMd, color: m3.onPrimary },

  statsRow: { flexDirection: 'row', gap: m3Space.sm },
  statCard: { flex: 1, backgroundColor: m3.surfaceContainer, borderRadius: m3Radius.lg, padding: m3Space.md, gap: 6 },
  statTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statLabel: { ...m3Type.labelXs, color: m3.onSurfaceVariant, letterSpacing: 0.6 },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  statValue: { ...m3Type.headlineMd, color: m3.onSurface },
  statBadge: { ...m3Type.labelSm, color: m3.secondary, letterSpacing: 0 },
  statUnit: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  statCaption: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  statBar: { height: 6, borderRadius: 3, backgroundColor: m3.surfaceVariant, overflow: 'hidden' },
  statBarFill: { height: '100%', borderRadius: 3, backgroundColor: m3.secondary },

  chipsWrap: { flexDirection: 'row', gap: m3Space.xs, paddingVertical: 2 },
  chipSpacing: {},

  serviceCard: { gap: m3Space.sm },
  serviceTop: { flexDirection: 'row', gap: m3Space.sm },
  serviceIcon: { width: 44, height: 44, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  serviceNameRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.xs },
  serviceName: { ...m3Type.headlineSm, fontSize: 17, color: m3.onSurface, flexShrink: 1 },
  servicePrice: { ...m3Type.headlineSm, fontSize: 17, color: m3.onSurface },
  serviceDesc: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
  serviceMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.sm, marginTop: 6 },
  serviceMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  serviceMetaText: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },

  assignedRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.sm, paddingHorizontal: 10, paddingVertical: 8 },
  assignedLabel: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  assignedValue: { ...m3Type.labelSm, color: m3.onSurface, letterSpacing: 0, flexShrink: 1, fontFamily: m3Type.labelSm.fontFamily },

  serviceFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m3Space.xs },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  toggleLabel: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0, flexShrink: 1 },
  footerActions: { flexDirection: 'row', alignItems: 'center', gap: m3Space.xs },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 12, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainer },
  editBtnText: { ...m3Type.labelMd, color: m3.onSurface },
  archiveBtn: { width: 34, height: 34, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },

  // --- edit sheet (kept from the prior screen, retinted) ---
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay },
  sheet: { maxHeight: '94%', backgroundColor: colors.background, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden' },
  sheetContent: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.sm },
  sheetTitle: { ...typography.heading, color: colors.text },
  label: { ...typography.caption, color: colors.text },
  input: { minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, ...typography.body, color: colors.text },
  multiline: { minHeight: 72, paddingTop: spacing.sm, textAlignVertical: 'top' },
  fields: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  numberField: { width: '31%', minWidth: 96, flexGrow: 1, gap: spacing.xs },
  toggle: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  toggleName: { ...typography.bodyStrong, color: colors.text },
  toggleDetail: { ...typography.caption, color: colors.textSecondary },
  helper: { ...typography.caption, color: colors.textSecondary },
  members: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  member: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radius.round, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  memberSelected: { borderColor: colors.success },
  memberText: { ...typography.caption, color: colors.text },
  error: { ...typography.caption, color: colors.negative },
});
