import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CreateQuoteBody, CustomerDto, QuoteDetailDto, QuoteDocumentType, ReviseQuoteBody, ServiceOfferingDto, UpdateQuoteBody } from '../apiTypes';
import {
  canSendDraft,
  detailLineItemsToDrafts,
  documentTypeLabel,
  emptyLineItem,
  lineItemDraftToInput,
  previewQuoteTotals,
  validateQuoteDraft,
  type LineItemDraft,
} from '../domain/quotes';
import { ApiError } from '../services/api';
import { customersApi, quotesApi, servicesApi } from '../services/endpoints';
import { RootStackParamList } from '../types';
import { formatMoney } from '../utils/format';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Error, M3Header, M3Loading, SectionTitle } from '../experience/businessKit';

type Props = NativeStackScreenProps<RootStackParamList, 'QuoteEditor'>;

export function QuoteEditorScreen({ route, navigation }: Props) {
  const quoteId = route.params?.quoteId;
  const revising = route.params?.mode === 'revise';
  const mode: 'create' | 'edit' | 'revise' = !quoteId ? 'create' : revising ? 'revise' : 'edit';

  const [loading, setLoading] = useState(mode !== 'create');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [documentType, setDocumentType] = useState<QuoteDocumentType>('QUOTE');
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([emptyLineItem()]);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [existing, setExisting] = useState<QuoteDetailDto | null>(null);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [services, setServices] = useState<ServiceOfferingDto[]>([]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [customerPage, catalog, detail] = await Promise.all([
        customersApi.list('', 1, 100).catch(() => ({ items: [] as CustomerDto[] })),
        servicesApi.list(true).catch(() => [] as ServiceOfferingDto[]),
        mode !== 'create' && quoteId ? quotesApi.get(quoteId) : Promise.resolve(null),
      ]);
      setCustomers(customerPage.items);
      setServices(catalog);
      if (detail) {
        setExisting(detail);
        setDocumentType(detail.documentType);
        setCustomerId(detail.origins.customerId ?? '');
        const drafts = detailLineItemsToDrafts(detail);
        setLineItems(drafts.length ? drafts : [emptyLineItem()]);
        setNotes(detail.currentRevision?.notes ?? '');
        setTerms(detail.currentRevision?.terms ?? '');
      }
    } catch (caught) {
      setLoadError(caught instanceof ApiError ? caught.message : 'Unable to load this quote.');
    } finally {
      setLoading(false);
    }
  }, [mode, quoteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => previewQuoteTotals(lineItems), [lineItems]);
  const validation = useMemo(() => validateQuoteDraft(lineItems), [lineItems]);
  const nonEmpty = lineItems.filter((li) => li.description.trim() || li.unitPrice.trim());

  const setItem = (index: number, patch: Partial<LineItemDraft>) => {
    setLineItems((current) => current.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  };
  const addItem = () => setLineItems((current) => [...current, emptyLineItem()]);
  const removeItem = (index: number) => setLineItems((current) => (current.length <= 1 ? current : current.filter((_, i) => i !== index)));

  const pickService = (index: number, service: ServiceOfferingDto) => {
    const current = lineItems[index]!;
    // Same service tapped again clears the link; otherwise adopt its name +
    // price (the user can still edit both afterwards - serviceOfferingId is
    // provenance only on the backend).
    if (current.serviceOfferingId === service.id) {
      setItem(index, { serviceOfferingId: null });
      return;
    }
    setItem(index, {
      serviceOfferingId: service.id,
      description: current.description.trim() ? current.description : service.name,
      unitPrice: service.price != null ? String(service.price) : current.unitPrice,
    });
  };

  const buildContent = () => ({
    lineItems: nonEmpty.map((li, i) => lineItemDraftToInput(li, i)),
    notes: notes.trim() || null,
    terms: terms.trim() || null,
  });

  const save = async (thenSend: boolean) => {
    if (saving) return;
    // For create/edit an empty draft is allowed; for revise or send it is not.
    const needsItems = thenSend || mode === 'revise';
    if (needsItems && nonEmpty.length === 0) {
      setFormError('Add at least one line item.');
      return;
    }
    if (validation.length > 0) {
      setFormError(validation[0]!.message);
      return;
    }
    if (mode !== 'create' && !existing?.currentRevision) {
      setFormError('This quote changed since you opened it. Reload to get the latest version.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      let saved: QuoteDetailDto;
      if (mode === 'create') {
        const body: CreateQuoteBody = { documentType, customerId: customerId || undefined, ...buildContent() };
        saved = await quotesApi.create(body);
      } else if (mode === 'revise') {
        // Send customerId only when the user actually changed it, so the
        // backend's PATCH-like preservation keeps every other association.
        const changedCustomer = customerId !== (existing!.origins.customerId ?? '');
        const body: ReviseQuoteBody = {
          expectedCurrentRevisionId: existing!.currentRevision!.id,
          ...(changedCustomer ? { customerId: customerId || null } : {}),
          ...buildContent(),
        };
        const result = await quotesApi.revise(existing!.id, body);
        saved = result.quote;
      } else {
        const body: UpdateQuoteBody = {
          expectedCurrentRevisionId: existing!.currentRevision!.id,
          leadId: existing!.origins.leadId,
          customerId: customerId || null,
          customerProfileId: existing!.origins.customerProfileId,
          appointmentId: existing!.origins.appointmentId,
          ...buildContent(),
        };
        saved = await quotesApi.patch(existing!.id, body);
      }

      if (thenSend) {
        try {
          await quotesApi.send(saved.id, saved.currentRevision?.id);
          Alert.alert('Quote sent', 'Open the quote to copy its secure link.');
        } catch (caught) {
          Alert.alert('Saved as draft', caught instanceof ApiError ? caught.message : 'The quote was saved but could not be sent.');
        }
      }
      navigation.navigate('QuoteDetail', { quoteId: saved.id });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        setFormError('This quote changed since you opened it. Reload to get the latest version.');
      } else {
        setFormError(caught instanceof ApiError ? caught.message : 'Unable to save this quote.');
      }
    } finally {
      setSaving(false);
    }
  };

  const title = mode === 'create' ? 'New quote' : mode === 'revise' ? 'Revise quote' : 'Edit draft';
  const sendable = mode !== 'revise' && canSendDraft('DRAFT', lineItems);

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        <M3Header businessName={title} onBack={() => navigation.goBack()} />
        <M3Loading label="Loading quote…" />
      </SafeAreaView>
    );
  }
  if (loadError) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        <M3Header businessName={title} onBack={() => navigation.goBack()} />
        <M3Error message={loadError} onRetry={() => void load()} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <M3Header businessName={title} onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.scrollBody} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.titleRow}>
            <View style={styles.flex1}>
              <Text style={styles.eyebrow}>{documentTypeLabel(documentType).toUpperCase()}</Text>
              <Text style={styles.pageTitle}>{existing ? existing.documentNumber : 'Server calculates the final totals'}</Text>
            </View>
            <Chip label={mode === 'revise' ? 'Revision' : 'Draft Mode'} tone="primaryFixed" />
          </View>

          {mode === 'create' ? (
            <View style={styles.chipRow}>
              {(['QUOTE', 'ESTIMATE'] as const).map((type) => (
                <Chip key={type} label={documentTypeLabel(type)} selected={documentType === type} onPress={() => setDocumentType(type)} />
              ))}
            </View>
          ) : null}

          {customers.length > 0 ? (
            <View style={styles.section}>
              <SectionTitle title="Customer" />
              <View style={styles.chipRow}>
                <Chip label="No customer" selected={!customerId} onPress={() => setCustomerId('')} />
                {customers.map((c) => (
                  <Chip key={c.id} label={c.name} selected={customerId === c.id} onPress={() => setCustomerId(c.id)} />
                ))}
              </View>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.lineItemsHeadRow}>
              <View style={styles.lineItemsHeadLeft}>
                <Icon name="receipt_long" size={18} color={m3.primary} />
                <SectionTitle title="Line items" />
              </View>
              {nonEmpty.length > 0 ? <Text style={styles.itemCount}>{nonEmpty.length} item{nonEmpty.length === 1 ? '' : 's'}</Text> : null}
            </View>
            <M3Card style={styles.itemsCard}>
              {lineItems.map((item, index) => {
                const itemErrors = validation.filter((e) => e.index === index);
                return (
                  <View key={index} style={styles.item}>
                    <View style={styles.itemHeader}>
                      <Text style={styles.itemLabel}>Item {index + 1}</Text>
                      {lineItems.length > 1 ? (
                        <Pressable accessibilityLabel={`Remove item ${index + 1}`} onPress={() => removeItem(index)} hitSlop={8}>
                          <Icon name="delete" size={18} color={m3.error} />
                        </Pressable>
                      ) : null}
                    </View>
                    {services.length > 0 ? (
                      <View style={styles.chipRow}>
                        {services.map((s) => (
                          <Chip key={s.id} label={s.name} selected={item.serviceOfferingId === s.id} onPress={() => pickService(index, s)} />
                        ))}
                      </View>
                    ) : null}
                    <TextInput
                      value={item.description}
                      onChangeText={(v) => setItem(index, { description: v })}
                      accessibilityLabel="Item description"
                      placeholder="Description"
                      placeholderTextColor={m3.outline}
                      style={styles.input}
                    />
                    <View style={styles.inlineFields}>
                      <LabeledInput label="Qty" value={item.quantity} onChangeText={(v) => setItem(index, { quantity: v })} keyboardType="decimal-pad" />
                      <LabeledInput label="Unit price" value={item.unitPrice} onChangeText={(v) => setItem(index, { unitPrice: v })} keyboardType="decimal-pad" />
                      <LabeledInput label="Discount" value={item.discountAmount} onChangeText={(v) => setItem(index, { discountAmount: v })} keyboardType="decimal-pad" />
                    </View>
                    <View style={styles.taxRow}>
                      <Text style={styles.itemLabel}>Taxable</Text>
                      <Switch
                        value={item.taxable}
                        onValueChange={(v) => setItem(index, { taxable: v })}
                        trackColor={{ false: m3.surfaceContainerHigh, true: m3.primary }}
                        thumbColor={m3.surfaceContainerLowest}
                      />
                    </View>
                    {itemErrors.map((e) => (
                      <Text key={e.field} style={styles.itemError}>{e.message}</Text>
                    ))}
                  </View>
                );
              })}
              <Pressable accessibilityRole="button" onPress={addItem} style={styles.addItemBtn}>
                <Icon name="add" size={18} color={m3.onSurface} />
                <Text style={styles.addItemText}>Add line item</Text>
              </Pressable>
            </M3Card>
          </View>

          <View style={styles.section}>
            <SectionTitle title="Notes & terms" />
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Notes for the customer (optional)"
              placeholderTextColor={m3.outline}
              multiline
              style={[styles.input, styles.multiline]}
            />
            <TextInput
              value={terms}
              onChangeText={setTerms}
              placeholder="Terms (optional)"
              placeholderTextColor={m3.outline}
              multiline
              style={[styles.input, styles.multiline]}
            />
          </View>

          <M3Card style={styles.totalsCard}>
            <Text style={styles.totalsHeading}>Financial summary</Text>
            <Row label="Subtotal" value={formatMoney(totals.subtotal, existing?.currency ?? 'USD')} />
            {totals.discountTotal > 0 ? <Row label="Discount" value={`−${formatMoney(totals.discountTotal, existing?.currency ?? 'USD')}`} /> : null}
            <View style={styles.totalBox}>
              <View>
                <Text style={styles.totalLabel}>Total Quotation</Text>
                <Text style={styles.previewNote}>Preview only · server calculates the final total</Text>
              </View>
              <Text style={styles.totalValue}>{formatMoney(totals.total, existing?.currency ?? 'USD')}</Text>
            </View>
          </M3Card>

          {formError ? <Text accessibilityRole="alert" style={styles.formError}>{formError}</Text> : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={() => void save(false)}
              style={[styles.primaryBtn, saving && styles.disabled]}
            >
              <Text style={styles.primaryBtnText}>{saving ? 'Saving…' : mode === 'revise' ? 'Save revision' : 'Save draft'}</Text>
            </Pressable>
            {mode !== 'revise' ? (
              <Pressable
                accessibilityRole="button"
                disabled={saving || !sendable}
                onPress={() => void save(true)}
                style={[styles.secondaryBtn, (saving || !sendable) && styles.disabled]}
              >
                <Icon name="send" size={16} color={m3.onSurface} />
                <Text style={styles.secondaryBtnText}>Save & send</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" disabled={saving} onPress={() => navigation.goBack()} style={[styles.ghostBtn, saving && styles.disabled]}>
              <Text style={styles.ghostBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function LabeledInput({ label, value, onChangeText, keyboardType }: { label: string; value: string; onChangeText: (v: string) => void; keyboardType?: 'decimal-pad' }) {
  return (
    <View style={styles.labeled}>
      <Text style={styles.labeledLabel}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} keyboardType={keyboardType} style={styles.input} placeholderTextColor={m3.outline} />
    </View>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.rowStrong]}>{label}</Text>
      <Text style={[styles.rowValue, strong && styles.rowStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  flex1: { flex: 1, minWidth: 0 },
  screen: { flex: 1, backgroundColor: m3.surface },
  scrollBody: { paddingHorizontal: m3Space.md, paddingTop: m3Space.sm, paddingBottom: m3Space.xxl, gap: m3Space.md },

  section: { gap: m3Space.xs },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm },
  eyebrow: { ...m3Type.labelSm, color: m3.outline, letterSpacing: 0.4 },
  pageTitle: { ...m3Type.headlineSm, color: m3.onSurface, marginTop: 2 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs },

  lineItemsHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineItemsHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemCount: { ...m3Type.labelSm, color: m3.outline },

  itemsCard: { gap: m3Space.sm },
  item: { backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.md, padding: m3Space.sm, gap: m3Space.xs },
  itemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemLabel: { ...m3Type.labelMd, color: m3.onSurface },
  inlineFields: { flexDirection: 'row', gap: m3Space.xs },
  labeled: { flex: 1, gap: 2 },
  labeledLabel: { ...m3Type.labelXs, color: m3.onSurfaceVariant },
  input: { minHeight: 44, backgroundColor: m3.surfaceContainerLowest, borderRadius: m3Radius.sm, paddingHorizontal: m3Space.sm, ...m3Type.bodyMd, color: m3.onSurface },
  multiline: { minHeight: 80, paddingTop: m3Space.xs, textAlignVertical: 'top' },
  taxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemError: { ...m3Type.bodySm, color: m3.error },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainerHigh },
  addItemText: { ...m3Type.labelMd, color: m3.onSurface },

  totalsCard: { gap: 6 },
  totalsHeading: { ...m3Type.labelSm, color: m3.outline, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  rowLabel: { ...m3Type.bodyMd, color: m3.onSurfaceVariant },
  rowValue: { ...m3Type.bodyMd, color: m3.onSurface },
  rowStrong: { ...m3Type.labelLg, color: m3.onSurface },
  totalBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.md, padding: m3Space.sm, marginTop: 6 },
  totalLabel: { ...m3Type.labelMd, color: m3.onSurface },
  previewNote: { ...m3Type.labelXs, color: m3.onSurfaceVariant, marginTop: 2, letterSpacing: 0 },
  totalValue: { ...m3Type.headlineSm, color: m3.primary },

  formError: { ...m3Type.bodySm, color: m3.error },

  actions: { gap: m3Space.xs },
  primaryBtn: { height: 48, borderRadius: m3Radius.md, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  primaryBtnText: { ...m3Type.labelLg, color: m3.onPrimary },
  secondaryBtn: { height: 48, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  secondaryBtnText: { ...m3Type.labelLg, color: m3.onSurface },
  ghostBtn: { height: 48, borderRadius: m3Radius.md, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { ...m3Type.labelLg, color: m3.onSurfaceVariant },
  disabled: { opacity: 0.5 },
});
