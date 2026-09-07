import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import { CountryPhoneInput } from '../components/CountryPhoneInput';
import { AudienceCenterDto, CustomerDto, SmartAudienceKey } from '../apiTypes';
import { ApiError } from '../services/api';
import { customersApi } from '../services/endpoints';
import { useAppState } from '../state/AppContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { colors, radius, spacing, typography } from '../theme';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { MainTabParamList, RootStackParamList } from '../types';

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

export function CustomersScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<MainTabParamList, 'Customers'>>();
  const { customers, customerTotal, customerPage, state, loadCustomers } = useAppState();
  const { refresh: refreshPlan } = usePlanExperience();
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [audiences, setAudiences] = useState<AudienceCenterDto | null>(null);
  const [audienceKey, setAudienceKey] = useState<SmartAudienceKey | null>(route.params?.audienceKey ?? null);

  useEffect(() => {
    const timer = setTimeout(() => void loadCustomers(search), 300);
    return () => clearTimeout(timer);
  }, [loadCustomers, search]);
  useEffect(() => {
    void customersApi.audiences().then(setAudiences).catch(() => setAudiences(null));
  }, []);
  useEffect(() => {
    if (route.params?.audienceKey) setAudienceKey(route.params.audienceKey);
  }, [route.params?.audienceKey]);

  const visibleCustomers = useMemo(
    () =>
      !audienceKey || !audiences
        ? customers
        : customers.filter((customer) =>
            audiences.audiences.find((item) => item.key === audienceKey)?.customerIds.includes(customer.id),
          ),
    [audienceKey, audiences, customers],
  );

  const create = async () => {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const customer = await customersApi.create({
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      void refreshPlan();
      setShowCreate(false);
      setName(''); setPhone(''); setEmail(''); setNotes('');
      await loadCustomers(search);
      navigation.navigate('CustomerProfile', { customerId: customer.id });
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Unable to create customer.');
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <M3Header
      businessName="Clients"
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      onAvatarPress={() => navigation.navigate('Main', { screen: 'Settings' })}
      hasNotifications={false}
    />
  );

  const audienceChips = audiences?.audiences ?? [];
  const loadingList = !state.customers.loaded && state.customers.loading;

  const renderCustomer = (customer: CustomerDto) => (
    <M3Card
      key={customer.id}
      onPress={() => navigation.navigate('CustomerProfile', { customerId: customer.id })}
      style={styles.clientCard}
    >
      <View style={styles.clientAvatar}>
        <Text style={styles.clientInitials}>{initials(customer.name) || '?'}</Text>
      </View>
      <View style={styles.flex}>
        <Text numberOfLines={1} style={styles.clientName}>
          {customer.name}
        </Text>
        <Text numberOfLines={1} style={styles.clientMeta}>
          {customer.phone ?? customer.email ?? 'No contact details'}
        </Text>
      </View>
      <View style={styles.clientChannel}>
        <Icon name={customer.phone ? 'sms' : customer.email ? 'mail' : 'person'} size={14} color={m3.onSurfaceVariant} />
      </View>
      <Icon name="chevron_right" size={18} color={m3.outline} />
    </M3Card>
  );

  return (
    <>
      <M3Screen header={header}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <View style={styles.titleWithCount}>
              <Text style={styles.title}>Clients & CRM</Text>
              <Chip label={`${customerTotal} active`} tone="secondary" />
            </View>
            <Text style={styles.titleMeta}>Patronage, lifetime value and retention</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => setShowCreate(true)} style={styles.addBtn}>
            <Icon name="person_add" size={20} color={m3.onPrimary} />
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <Icon name="search" size={18} color={m3.outline} style={styles.searchIcon} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, phone, or email"
            placeholderTextColor={m3.outline}
            style={styles.searchInput}
          />
        </View>

        {audienceChips.length ? (
          <View style={styles.chipsWrap}>
            <Chip label={`All (${customerTotal})`} selected={!audienceKey} onPress={() => setAudienceKey(null)} />
            {audienceChips.map((a) => (
              <Chip
                key={a.key}
                label={a.label}
                count={a.customerIds.length}
                selected={audienceKey === a.key}
                onPress={() => setAudienceKey(a.key)}
              />
            ))}
          </View>
        ) : null}

        {loadingList ? (
          <M3Loading label="Loading clients…" />
        ) : state.customers.error ? (
          <M3Error message={state.customers.error} onRetry={() => void loadCustomers(search)} />
        ) : visibleCustomers.length ? (
          <View style={styles.list}>{visibleCustomers.map(renderCustomer)}</View>
        ) : (
          <M3Empty
            icon="contacts"
            title={audienceKey ? 'No matching clients' : search ? 'No clients found' : 'No clients yet'}
            message={
              audienceKey
                ? 'Load more clients or choose another audience.'
                : search
                  ? 'Try a different search.'
                  : 'Add your first client to begin.'
            }
          />
        )}

        {customers.length < customerTotal ? (
          <Pressable
            accessibilityRole="button"
            disabled={state.customers.loading}
            onPress={() => void loadCustomers(search, customerPage + 1, true)}
            style={styles.loadMore}
          >
            <Text style={styles.loadMoreText}>{state.customers.loading ? 'Loading…' : 'Load more clients'}</Text>
          </Pressable>
        ) : null}
      </M3Screen>

      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <Pressable style={styles.overlay} onPress={() => !saving && setShowCreate(false)}>
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <Text style={styles.sheetTitle}>New client</Text>
            <Field label="Name" value={name} onChangeText={setName} />
            <CountryPhoneInput value={phone} onChange={setPhone} />
            <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            <Field label="Notes" value={notes} onChangeText={setNotes} />
            {formError ? <Text style={styles.error}>{formError}</Text> : null}
            <PrimaryButton disabled={saving || !name.trim()} fullWidth label={saving ? 'Creating…' : 'Create client'} onPress={() => void create()} />
            <SecondaryButton disabled={saving} fullWidth label="Cancel" onPress={() => setShowCreate(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function Field({
  label,
  ...props
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: 'email-address';
  autoCapitalize?: 'none';
}) {
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
  titleWithCount: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  titleMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
  addBtn: { width: 40, height: 40, borderRadius: m3Radius.md, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },

  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.md, paddingHorizontal: 12, height: 44 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, ...m3Type.bodyMd, color: m3.onSurface, padding: 0 },

  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },

  loadMore: { height: 44, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  loadMoreText: { ...m3Type.labelMd, color: m3.onSurface },

  clientCard: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  clientAvatar: { width: 48, height: 48, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  clientInitials: { ...m3Type.labelLg, color: m3.primary },
  clientName: { ...m3Type.headlineSm, fontSize: 17, color: m3.onSurface },
  clientMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  clientChannel: { width: 26, height: 26, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainerLow, alignItems: 'center', justifyContent: 'center' },

  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.xl, paddingBottom: 40, gap: spacing.md },
  sheetTitle: { ...typography.heading, color: colors.text },
  label: { ...typography.caption, color: colors.text, marginBottom: spacing.xs },
  input: { minHeight: 48, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, ...typography.body, color: colors.text },
  error: { ...typography.caption, color: colors.negative },
});
