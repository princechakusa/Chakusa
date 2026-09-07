import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppHeader, Divider, EmptyState, ErrorState, InfoRow, LoadingState, Screen, SectionHeader, StatusBadge } from '../../components/ui';
import type { CustomerInvoiceDetailDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDate, formatMoney } from '../../utils/format';
import { customerInvoiceDetailNote, customerInvoiceHeadline, customerInvoiceStatusLabel, isCustomerInvoiceOverdue } from '../domain/customerInvoices';
import { customerInvoicesApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type DetailRoute = RouteProp<CustomerRootStackParamList, 'CustomerInvoiceDetail'>;

// PROGRAM 3 / Invoicing I7: a single invoice a business sent this
// customer. Read-only. No pay button — payment happens directly with the
// business until a real payment flow exists.

export function CustomerInvoiceDetailScreen() {
  const route = useRoute<DetailRoute>();
  const { invoiceId } = route.params;
  const [invoice, setInvoice] = useState<CustomerInvoiceDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      setInvoice(await customerInvoicesApi.get(invoiceId));
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load this invoice.');
    } finally {
      setLoaded(true);
    }
  }, [invoiceId]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!loaded) return <Screen><LoadingState label="Loading invoice…" /></Screen>;
  if (error && !invoice) return <Screen><ErrorState message={error} onRetry={() => void load()} /></Screen>;
  if (!invoice) return <Screen><EmptyState icon="receipt-outline" title="Invoice not found" message="This invoice is no longer available." /></Screen>;

  const overdue = isCustomerInvoiceOverdue(invoice);
  const revision = invoice.revision;

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader
        eyebrow={invoice.business.name.toUpperCase()}
        title={invoice.invoiceNumber}
        subtitle={customerInvoiceHeadline(invoice.status)}
        right={<StatusBadge label={customerInvoiceStatusLabel(invoice.status, overdue)} />}
      />

      <View style={styles.noteCard}>
        <Text style={styles.note}>{customerInvoiceDetailNote(invoice.status, overdue)}</Text>
      </View>

      <View style={styles.card}>
        <InfoRow label="From" value={invoice.business.name} />
        <InfoRow label="Currency" value={invoice.currency} />
        {invoice.issueDate ? <InfoRow label="Issued" value={formatDate(invoice.issueDate)} /> : null}
        {invoice.dueDate ? <InfoRow label="Due" value={formatDate(invoice.dueDate)} /> : null}
      </View>

      <SectionHeader title="Line items" />
      {revision && revision.lineItems.length > 0 ? (
        <View style={styles.card}>
          {revision.lineItems.map((line, index) => (
            <View key={`${line.description}-${index}`}>
              {index > 0 ? <Divider /> : null}
              <View style={styles.lineRow}>
                <View style={styles.lineMain}>
                  <Text style={styles.lineDesc}>{line.description}</Text>
                  <Text style={styles.lineMeta}>
                    {line.quantity} × {formatMoney(line.unitPrice, invoice.currency)}
                    {line.discountAmount !== '0.00' ? ` · −${formatMoney(line.discountAmount, invoice.currency)}` : ''}
                    {line.taxable ? ' · taxable' : ''}
                  </Text>
                </View>
                <Text style={styles.lineTotal}>{formatMoney(line.lineTotal, invoice.currency)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.card}><Text style={styles.muted}>No line items.</Text></View>
      )}

      {revision ? (
        <View style={styles.card}>
          <InfoRow label="Subtotal" value={formatMoney(revision.totals.subtotal, invoice.currency)} />
          {revision.totals.discountTotal !== '0.00' ? <InfoRow label="Discount" value={`−${formatMoney(revision.totals.discountTotal, invoice.currency)}`} /> : null}
          {revision.totals.taxTotal !== '0.00' ? <InfoRow label="Tax" value={formatMoney(revision.totals.taxTotal, invoice.currency)} /> : null}
          <Divider />
          <InfoRow label="Total" value={formatMoney(revision.totals.total, invoice.currency)} />
        </View>
      ) : null}

      {revision?.notes ? (
        <>
          <SectionHeader title="Notes" />
          <View style={styles.card}><Text style={styles.body}>{revision.notes}</Text></View>
        </>
      ) : null}
      {revision?.terms ? (
        <>
          <SectionHeader title="Terms" />
          <View style={styles.card}><Text style={styles.body}>{revision.terms}</Text></View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  noteCard: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  note: { ...typography.caption, color: colors.textSecondary },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: spacing.sm, gap: spacing.sm },
  lineMain: { flex: 1 },
  lineDesc: { ...typography.bodyStrong, color: colors.text },
  lineMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  lineTotal: { ...typography.bodyStrong, color: colors.text },
  body: { ...typography.body, color: colors.text, paddingVertical: spacing.sm },
  muted: { ...typography.body, color: colors.textSecondary, paddingVertical: spacing.sm },
});
