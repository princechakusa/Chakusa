import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { InvoiceDetailDto } from '../apiTypes';
import { AppHeader, Divider, EmptyState, ErrorState, InfoRow, LoadingState, PrimaryButton, Screen, SecondaryButton, SectionHeader, StatusBadge } from '../components/ui';
import { availableInvoiceActions, canCollectInvoicePayment, invoicePaymentStateLabel, invoiceStatusLabel, isInvoiceOverdue, type BusinessRole } from '../domain/invoices';
import { ApiError } from '../services/api';
import { invoicesApi } from '../services/endpoints';
import { copyMessage } from '../services/messaging';
import { useAuth } from '../state/AuthContext';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDate, formatMoney } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'InvoiceDetail'>;

function normalizeRole(role: string | null): BusinessRole {
  return role === 'OWNER' || role === 'ADMIN' ? role : 'STAFF';
}

export function InvoiceDetailScreen({ route, navigation }: Props) {
  const { role } = useAuth();
  const memberRole = normalizeRole(role);
  const [invoice, setInvoice] = useState<InvoiceDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setInvoice(await invoicesApi.get(route.params.invoiceId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to load this invoice.');
    } finally {
      setLoading(false);
    }
  }, [route.params.invoiceId]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => void load());
    return unsub;
  }, [navigation, load]);

  const actions = useMemo(() => (invoice ? availableInvoiceActions(invoice.status, memberRole) : []), [invoice, memberRole]);

  const send = async () => {
    if (!invoice || busy) return;
    setBusy('send');
    try {
      const result = await invoicesApi.send(invoice.id);
      await copyMessage(result.accessUrl);
      Alert.alert('Invoice sent', 'A secure link is on your clipboard — share it with your customer however you like.');
      await load();
    } catch (caught) {
      Alert.alert('Couldn’t send this invoice', caught instanceof ApiError ? caught.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const collectPayment = async () => {
    if (!invoice || busy) return;
    setBusy('pay');
    try {
      const result = await invoicesApi.paymentLink(invoice.id);
      if (result.checkoutUrl) {
        await copyMessage(result.checkoutUrl);
        Alert.alert('Payment link copied', 'A secure Stripe payment link is on your clipboard — send it to your customer.');
      } else {
        Alert.alert('Payment not ready', 'Could not start a payment for this invoice.');
      }
      await load();
    } catch (caught) {
      Alert.alert('Couldn’t start a payment', caught instanceof ApiError ? caught.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const shareLink = async () => {
    if (!invoice || busy) return;
    setBusy('link');
    try {
      const result = await invoicesApi.reissueLink(invoice.id);
      await copyMessage(result.accessUrl);
      Alert.alert('Secure link copied', 'A fresh link to this invoice is on your clipboard. Any previous link is now inactive.');
      await load();
    } catch (caught) {
      Alert.alert('Couldn’t create a link', caught instanceof ApiError ? caught.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const voidInvoice = () => {
    if (!invoice || busy) return;
    Alert.alert('Void this invoice?', 'The customer link will stop working and the invoice can no longer be sent or collected. This cannot be undone.', [
      { text: 'Keep invoice', style: 'cancel' },
      {
        text: 'Void invoice',
        style: 'destructive',
        onPress: async () => {
          setBusy('void');
          try {
            setInvoice(await invoicesApi.void(invoice.id));
          } catch (caught) {
            Alert.alert('Couldn’t void', caught instanceof ApiError ? caught.message : 'Please try again.');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const deleteDraft = () => {
    if (!invoice || busy) return;
    Alert.alert('Delete this draft?', 'This draft invoice will be permanently removed.', [
      { text: 'Keep draft', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          try {
            await invoicesApi.remove(invoice.id);
            navigation.goBack();
          } catch (caught) {
            Alert.alert('Couldn’t delete', caught instanceof ApiError ? caught.message : 'Please try again.');
            setBusy(null);
          }
        },
      },
    ]);
  };

  if (loading && !invoice) return <Screen><LoadingState label="Loading invoice…" /></Screen>;
  if (error && !invoice) return <Screen><ErrorState message={error} onRetry={() => void load()} /></Screen>;
  if (!invoice) return <Screen><EmptyState title="Invoice not found" message="This invoice is no longer available." icon="receipt-outline" /></Screen>;

  const revision = invoice.currentRevision;
  const disabled = Boolean(busy);
  const overdue = isInvoiceOverdue(invoice);

  return (
    <Screen>
      <AppHeader
        eyebrow="INVOICE"
        title={invoice.invoiceNumber}
        subtitle={invoice.customer?.name ?? 'No customer linked'}
        right={<StatusBadge label={overdue ? 'Overdue' : invoiceStatusLabel(invoice.status)} />}
      />

      <View style={styles.card}>
        <InfoRow label="Status" value={invoiceStatusLabel(invoice.status)} />
        <InfoRow label="Currency" value={invoice.currency} />
        {invoice.issueDate ? <InfoRow label="Issued" value={formatDate(invoice.issueDate)} /> : null}
        {invoice.dueDate ? <InfoRow label="Due" value={formatDate(invoice.dueDate)} /> : null}
        <InfoRow label="Created" value={formatDate(invoice.createdAt)} />
        {revision ? <InfoRow label="Revision" value={`#${revision.revisionNumber}`} /> : null}
      </View>

      {invoice.quoteProvenance ? (
        <View style={styles.card}>
          <Text style={styles.muted}>Created from an accepted quote.</Text>
        </View>
      ) : null}

      {invoice.status === 'SENT' || Number(invoice.payment.amountPaid) > 0 ? (
        <>
          <SectionHeader title="Payment" />
          <View style={styles.card}>
            <InfoRow label="Invoice total" value={formatMoney(invoice.payment.invoiceTotal, invoice.currency)} />
            {Number(invoice.payment.amountPaid) > 0 ? <InfoRow label="Paid" value={formatMoney(invoice.payment.amountPaid, invoice.currency)} /> : null}
            {Number(invoice.payment.amountRefunded) > 0 ? <InfoRow label="Refunded" value={`−${formatMoney(invoice.payment.amountRefunded, invoice.currency)}`} /> : null}
            <Divider />
            <InfoRow label="Outstanding" value={formatMoney(invoice.payment.outstandingBalance, invoice.currency)} />
            {invoicePaymentStateLabel(invoice.payment.state) ? (
              <InfoRow label="Status" value={invoicePaymentStateLabel(invoice.payment.state)!} />
            ) : null}
          </View>
        </>
      ) : null}

      <SectionHeader title="Line items" />
      {revision && revision.lineItems.length > 0 ? (
        <View style={styles.card}>
          {revision.lineItems.map((li, index) => (
            <View key={li.id}>
              {index > 0 ? <Divider /> : null}
              <View style={styles.lineRow}>
                <View style={styles.lineMain}>
                  <Text style={styles.lineDesc}>{li.description}</Text>
                  <Text style={styles.lineMeta}>
                    {li.quantity} × {formatMoney(li.unitPrice, invoice.currency)}
                    {li.discountAmount !== '0.00' ? ` · −${formatMoney(li.discountAmount, invoice.currency)}` : ''}
                    {li.taxable ? ' · taxable' : ''}
                  </Text>
                </View>
                <Text style={styles.lineTotal}>{formatMoney(li.lineTotal, invoice.currency)}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.muted}>No line items yet.</Text>
        </View>
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

      {invoice.revisionHistory.length > 1 ? (
        <>
          <SectionHeader title="Revision history" />
          <View style={styles.card}>
            {invoice.revisionHistory.map((entry) => (
              <InfoRow key={entry.id} label={`#${entry.revisionNumber} · ${formatDate(entry.createdAt)}`} value={formatMoney(entry.total, invoice.currency)} />
            ))}
          </View>
        </>
      ) : null}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        {actions.includes('editDraft') ? (
          <PrimaryButton disabled={disabled} fullWidth icon="create-outline" label="Edit draft" onPress={() => navigation.navigate('InvoiceEditor', { invoiceId: invoice.id })} />
        ) : null}
        {actions.includes('send') ? (
          <PrimaryButton disabled={disabled} fullWidth icon="send-outline" label={busy === 'send' ? 'Sending…' : 'Send invoice'} onPress={() => void send()} />
        ) : null}
        {actions.includes('shareLink') ? (
          <SecondaryButton disabled={disabled} fullWidth icon="link-outline" label={busy === 'link' ? 'Working…' : 'Share secure link'} onPress={() => void shareLink()} />
        ) : null}
        {canCollectInvoicePayment(invoice.status, invoice.payment) ? (
          <SecondaryButton disabled={disabled} fullWidth icon="card-outline" label={busy === 'pay' ? 'Working…' : 'Copy payment link'} onPress={() => void collectPayment()} />
        ) : null}
        {actions.includes('void') ? (
          <SecondaryButton disabled={disabled} fullWidth icon="close-circle-outline" label={busy === 'void' ? 'Voiding…' : 'Void invoice'} onPress={voidInvoice} />
        ) : null}
        {actions.includes('deleteDraft') ? (
          <SecondaryButton disabled={disabled} fullWidth icon="trash-outline" label={busy === 'delete' ? 'Deleting…' : 'Delete draft'} onPress={deleteDraft} />
        ) : null}
        {invoice.customer ? (
          <SecondaryButton disabled={disabled} fullWidth icon="person-outline" label="View customer" onPress={() => navigation.navigate('CustomerProfile', { customerId: invoice.customer!.id })} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: spacing.sm, gap: spacing.sm },
  lineMain: { flex: 1 },
  lineDesc: { ...typography.bodyStrong, color: colors.text },
  lineMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  lineTotal: { ...typography.bodyStrong, color: colors.text },
  body: { ...typography.body, color: colors.text, paddingVertical: spacing.sm },
  muted: { ...typography.body, color: colors.textSecondary, paddingVertical: spacing.sm },
  actions: { gap: spacing.xs, marginTop: spacing.md },
  error: { ...typography.caption, color: colors.negative, marginTop: spacing.sm },
});
