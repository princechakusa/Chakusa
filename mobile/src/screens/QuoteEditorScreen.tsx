import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { CreateQuoteBody, QuoteDetailDto, QuoteDocumentType, ReviseQuoteBody, UpdateQuoteBody } from '../apiTypes';
import { AppHeader, Divider, ErrorState, LoadingState, PrimaryButton, Screen, SecondaryButton, SectionHeader } from '../components/ui';
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
import { quotesApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatMoney } from '../utils/format';

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
  const [existing, setExisting] = useState<QuoteDetailDto | null>(null);

  const load = useCallback(async () => {
    if (mode === 'create' || !quoteId) return;
    setLoadError(null);
    try {
      const detail = await quotesApi.get(quoteId);
      setExisting(detail);
      setDocumentType(detail.documentType);
      const drafts = detailLineItemsToDrafts(detail);
      setLineItems(drafts.length ? drafts : [emptyLineItem()]);
      setNotes(detail.currentRevision?.notes ?? '');
      setTerms(detail.currentRevision?.terms ?? '');
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
        const body: CreateQuoteBody = { documentType, ...buildContent() };
        saved = await quotesApi.create(body);
      } else if (mode === 'revise') {
        const body: ReviseQuoteBody = { expectedCurrentRevisionId: existing!.currentRevision!.id, ...buildContent() };
        const result = await quotesApi.revise(existing!.id, body);
        saved = result.quote;
      } else {
        const body: UpdateQuoteBody = {
          expectedCurrentRevisionId: existing!.currentRevision!.id,
          leadId: existing!.origins.leadId,
          customerId: existing!.origins.customerId,
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

  if (loading) return <Screen><LoadingState label="Loading quote…" /></Screen>;
  if (loadError) return <Screen><ErrorState message={loadError} onRetry={() => void load()} /></Screen>;

  const title = mode === 'create' ? 'New quote' : mode === 'revise' ? 'Revise quote' : 'Edit draft';
  const sendable = mode !== 'revise' && canSendDraft('DRAFT', lineItems);

  return (
    <Screen>
      <AppHeader title={title} subtitle={existing ? existing.documentNumber : 'Server calculates the final totals'} />

      {mode === 'create' ? (
        <View style={styles.typeRow}>
          {(['QUOTE', 'ESTIMATE'] as const).map((type) => (
            <Pressable
              key={type}
              onPress={() => setDocumentType(type)}
              style={[styles.typeChip, documentType === type && styles.typeChipActive]}
            >
              <Text style={[styles.typeChipText, documentType === type && styles.typeChipTextActive]}>{documentTypeLabel(type)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <SectionHeader title="Line items" />
      {lineItems.map((item, index) => {
        const itemErrors = validation.filter((e) => e.index === index);
        return (
          <View key={index} style={styles.item}>
            <View style={styles.itemHeader}>
              <Text style={styles.itemLabel}>Item {index + 1}</Text>
              {lineItems.length > 1 ? (
                <Pressable accessibilityLabel={`Remove item ${index + 1}`} onPress={() => removeItem(index)}>
                  <Ionicons name="trash-outline" size={18} color={colors.negative} />
                </Pressable>
              ) : null}
            </View>
            <TextInput
              value={item.description}
              onChangeText={(v) => setItem(index, { description: v })}
              placeholder="Description"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
            />
            <View style={styles.inlineFields}>
              <LabeledInput label="Qty" value={item.quantity} onChangeText={(v) => setItem(index, { quantity: v })} keyboardType="decimal-pad" />
              <LabeledInput label="Unit price" value={item.unitPrice} onChangeText={(v) => setItem(index, { unitPrice: v })} keyboardType="decimal-pad" />
              <LabeledInput label="Discount" value={item.discountAmount} onChangeText={(v) => setItem(index, { discountAmount: v })} keyboardType="decimal-pad" />
            </View>
            <View style={styles.taxRow}>
              <Text style={styles.itemLabel}>Taxable</Text>
              <Switch value={item.taxable} onValueChange={(v) => setItem(index, { taxable: v })} />
            </View>
            {itemErrors.map((e) => (
              <Text key={e.field} style={styles.itemError}>{e.message}</Text>
            ))}
          </View>
        );
      })}
      <SecondaryButton compact icon="add" label="Add line item" onPress={addItem} />

      <SectionHeader title="Notes & terms" />
      <TextInput value={notes} onChangeText={setNotes} placeholder="Notes for the customer (optional)" placeholderTextColor={colors.textSecondary} multiline style={[styles.input, styles.multiline]} />
      <TextInput value={terms} onChangeText={setTerms} placeholder="Terms (optional)" placeholderTextColor={colors.textSecondary} multiline style={[styles.input, styles.multiline]} />

      <View style={styles.totals}>
        <Row label="Subtotal" value={formatMoney(totals.subtotal, existing?.currency ?? 'USD')} />
        {totals.discountTotal > 0 ? <Row label="Discount" value={`−${formatMoney(totals.discountTotal, existing?.currency ?? 'USD')}`} /> : null}
        <Divider />
        <Row label="Estimated total" value={formatMoney(totals.total, existing?.currency ?? 'USD')} strong />
        <Text style={styles.previewNote}>Preview only — the server calculates the final totals on save.</Text>
      </View>

      {formError ? <Text accessibilityRole="alert" style={styles.formError}>{formError}</Text> : null}

      <View style={styles.actions}>
        <PrimaryButton
          disabled={saving}
          fullWidth
          label={saving ? 'Saving…' : mode === 'revise' ? 'Save revision' : 'Save draft'}
          onPress={() => void save(false)}
        />
        {mode !== 'revise' ? (
          <SecondaryButton
            disabled={saving || !sendable}
            fullWidth
            icon="send-outline"
            label="Save & send"
            onPress={() => void save(true)}
          />
        ) : null}
        <SecondaryButton disabled={saving} fullWidth label="Cancel" onPress={() => navigation.goBack()} />
      </View>
    </Screen>
  );
}

function LabeledInput({ label, value, onChangeText, keyboardType }: { label: string; value: string; onChangeText: (v: string) => void; keyboardType?: 'decimal-pad' }) {
  return (
    <View style={styles.labeled}>
      <Text style={styles.labeledLabel}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType} style={styles.input} placeholderTextColor={colors.textSecondary} />
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
  typeRow: { flexDirection: 'row', gap: spacing.xs },
  typeChip: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderRadius: radius.round, borderWidth: 1, borderColor: colors.border },
  typeChipActive: { borderColor: colors.primary, backgroundColor: colors.surface },
  typeChipText: { ...typography.caption, color: colors.textSecondary },
  typeChipTextActive: { color: colors.primary, fontWeight: '700' },
  item: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.sm },
  itemHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemLabel: { ...typography.caption, color: colors.text },
  inlineFields: { flexDirection: 'row', gap: spacing.xs },
  labeled: { flex: 1, gap: 2 },
  labeledLabel: { ...typography.micro, color: colors.textSecondary },
  input: { minHeight: 44, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.sm, ...typography.body, color: colors.text },
  multiline: { minHeight: 80, paddingTop: spacing.sm, textAlignVertical: 'top', marginBottom: spacing.sm },
  taxRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemError: { ...typography.caption, color: colors.negative },
  totals: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.md, gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { ...typography.body, color: colors.textSecondary },
  rowValue: { ...typography.body, color: colors.text },
  rowStrong: { ...typography.bodyStrong, color: colors.text },
  previewNote: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.xs },
  formError: { ...typography.caption, color: colors.negative, marginTop: spacing.sm },
  actions: { gap: spacing.xs, marginTop: spacing.md },
});
