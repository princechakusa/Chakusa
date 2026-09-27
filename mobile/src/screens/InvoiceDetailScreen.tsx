import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InvoiceDetailDto } from '../apiTypes';
import { availableInvoiceActions, canCollectInvoicePayment, invoicePaymentStateLabel, invoiceStatusLabel, isInvoiceOverdue, type BusinessRole } from '../domain/invoices';
import { ApiError } from '../services/api';
import { invoicesApi } from '../services/endpoints';
import { copyMessage } from '../services/messaging';
import { useAuth } from '../state/AuthContext';
import { RootStackParamList } from '../types';
import { formatDate, formatMoney } from '../utils/format';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, SectionTitle } from '../experience/businessKit';

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
      Alert.alert('Invoice sent', 'A secure link is on your clipboard - share it with your customer however you like.');
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
        Alert.alert('Payment link copied', 'A secure Stripe payment link is on your clipboard - send it to your customer.');
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

  if (loading && !invoice) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        <M3Header businessName="Invoice" onBack={() => navigation.goBack()} />
        <M3Loading label="Loading invoice…" />
      </SafeAreaView>
    );
  }
  if (error && !invoice) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        <M3Header businessName="Invoice" onBack={() => navigation.goBack()} />
        <M3Error message={error} onRetry={() => void load()} />
      </SafeAreaView>
    );
  }
  if (!invoice) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        <M3Header businessName="Invoice" onBack={() => navigation.goBack()} />
        <M3Empty icon="receipt" title="Invoice not found" message="This invoice is no longer available." />
      </SafeAreaView>
    );
  }

  const revision = invoice.currentRevision;
  const disabled = Boolean(busy);
  const overdue = isInvoiceOverdue(invoice);

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <M3Header businessName={invoice.invoiceNumber} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <Text style={styles.eyebrow}>INVOICE</Text>
            <Text style={styles.pageTitle}>{invoice.customer?.name ?? 'No customer linked'}</Text>
          </View>
          <Chip
            label={overdue ? 'Overdue' : invoiceStatusLabel(invoice.status)}
            tone={overdue ? 'error' : invoice.status === 'SENT' ? 'secondary' : invoice.status === 'VOID' ? 'error' : 'neutral'}
          />
        </View>

        <M3Card style={styles.infoCard}>
          <InfoRow label="Status" value={invoiceStatusLabel(invoice.status)} />
          <InfoRow label="Currency" value={invoice.currency} />
          {invoice.issueDate ? <InfoRow label="Issued" value={formatDate(invoice.issueDate)} /> : null}
          {invoice.dueDate ? <InfoRow label="Due" value={formatDate(invoice.dueDate)} /> : null}
          <InfoRow label="Created" value={formatDate(invoice.createdAt)} />
          {revision ? <InfoRow label="Revision" value={`#${revision.revisionNumber}`} /> : null}
        </M3Card>

        {invoice.quoteProvenance ? (
          <M3Card>
            <Text style={styles.muted}>Created from an accepted quote.</Text>
          </M3Card>
        ) : null}

        {invoice.status === 'SENT' || Number(invoice.payment.amountPaid) > 0 ? (
          <View style={styles.section}>
            <SectionTitle title="Payment" />
            <M3Card style={styles.infoCard}>
              <InfoRow label="Invoice total" value={formatMoney(invoice.payment.invoiceTotal, invoice.currency)} />
              {Number(invoice.payment.amountPaid) > 0 ? <InfoRow label="Paid" value={formatMoney(invoice.payment.amountPaid, invoice.currency)} /> : null}
              {Number(invoice.payment.amountRefunded) > 0 ? <InfoRow label="Refunded" value={`−${formatMoney(invoice.payment.amountRefunded, invoice.currency)}`} /> : null}
              <View style={styles.totalBox}>
                <Text style={styles.totalLabel}>Outstanding</Text>
                <Text style={styles.totalValue}>{formatMoney(invoice.payment.outstandingBalance, invoice.currency)}</Text>
              </View>
              {invoicePaymentStateLabel(invoice.payment.state) ? (
                <InfoRow label="Status" value={invoicePaymentStateLabel(invoice.payment.state)!} />
              ) : null}
            </M3Card>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.lineItemsHeadRow}>
            <View style={styles.lineItemsHeadLeft}>
              <Icon name="receipt_long" size={18} color={m3.primary} />
              <SectionTitle title="Line items" />
            </View>
            {revision ? <Text style={styles.itemCount}>{revision.lineItems.length} item{revision.lineItems.length === 1 ? '' : 's'}</Text> : null}
          </View>
          {revision && revision.lineItems.length > 0 ? (
            <M3Card style={styles.itemsCard}>
              {revision.lineItems.map((li) => (
                <View key={li.id} style={styles.item}>
                  <View style={styles.flex}>
                    <Text style={styles.itemDesc}>{li.description}</Text>
                    <Text style={styles.itemMeta}>
                      {li.quantity} × {formatMoney(li.unitPrice, invoice.currency)}
                      {li.discountAmount !== '0.00' ? ` · −${formatMoney(li.discountAmount, invoice.currency)}` : ''}
                      {li.taxable ? ' · taxable' : ''}
                    </Text>
                  </View>
                  <Text style={styles.itemTotal}>{formatMoney(li.lineTotal, invoice.currency)}</Text>
                </View>
              ))}
            </M3Card>
          ) : (
            <M3Card>
              <Text style={styles.muted}>No line items yet.</Text>
            </M3Card>
          )}
        </View>

        {revision ? (
          <M3Card style={styles.totalsCard}>
            <Row label="Subtotal" value={formatMoney(revision.totals.subtotal, invoice.currency)} />
            {revision.totals.discountTotal !== '0.00' ? <Row label="Discount" value={`−${formatMoney(revision.totals.discountTotal, invoice.currency)}`} /> : null}
            {revision.totals.taxTotal !== '0.00' ? <Row label="Tax" value={formatMoney(revision.totals.taxTotal, invoice.currency)} /> : null}
            <View style={styles.totalBox}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalValue}>{formatMoney(revision.totals.total, invoice.currency)}</Text>
            </View>
          </M3Card>
        ) : null}

        {revision?.notes ? (
          <View style={styles.section}>
            <SectionTitle title="Notes" />
            <M3Card><Text style={styles.body}>{revision.notes}</Text></M3Card>
          </View>
        ) : null}
        {revision?.terms ? (
          <View style={styles.section}>
            <SectionTitle title="Terms" />
            <M3Card><Text style={styles.body}>{revision.terms}</Text></M3Card>
          </View>
        ) : null}

        {invoice.revisionHistory.length > 1 ? (
          <View style={styles.section}>
            <SectionTitle title="Revision history" />
            <M3Card style={styles.infoCard}>
              {invoice.revisionHistory.map((entry) => (
                <InfoRow key={entry.id} label={`#${entry.revisionNumber} · ${formatDate(entry.createdAt)}`} value={formatMoney(entry.total, invoice.currency)} />
              ))}
            </M3Card>
          </View>
        ) : null}

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

        <View style={styles.actions}>
          {actions.includes('editDraft') ? (
            <Pressable accessibilityRole="button" disabled={disabled} onPress={() => navigation.navigate('InvoiceEditor', { invoiceId: invoice.id })} style={[styles.primaryBtn, disabled && styles.disabled]}>
              <Icon name="edit" size={16} color={m3.onPrimary} />
              <Text style={styles.primaryBtnText}>Edit draft</Text>
            </Pressable>
          ) : null}
          {actions.includes('send') ? (
            <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void send()} style={[styles.primaryBtn, disabled && styles.disabled]}>
              <Icon name="send" size={16} color={m3.onPrimary} />
              <Text style={styles.primaryBtnText}>{busy === 'send' ? 'Sending…' : 'Send invoice'}</Text>
            </Pressable>
          ) : null}
          {actions.includes('shareLink') ? (
            <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void shareLink()} style={[styles.secondaryBtn, disabled && styles.disabled]}>
              <Icon name="link" size={16} color={m3.onSurface} />
              <Text style={styles.secondaryBtnText}>{busy === 'link' ? 'Working…' : 'Share secure link'}</Text>
            </Pressable>
          ) : null}
          {canCollectInvoicePayment(invoice.status, invoice.payment) ? (
            <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void collectPayment()} style={[styles.secondaryBtn, disabled && styles.disabled]}>
              <Icon name="credit_card" size={16} color={m3.onSurface} />
              <Text style={styles.secondaryBtnText}>{busy === 'pay' ? 'Working…' : 'Copy payment link'}</Text>
            </Pressable>
          ) : null}
          {actions.includes('void') ? (
            <Pressable accessibilityRole="button" disabled={disabled} onPress={voidInvoice} style={[styles.secondaryBtn, disabled && styles.disabled]}>
              <Icon name="cancel" size={16} color={m3.onSurface} />
              <Text style={styles.secondaryBtnText}>{busy === 'void' ? 'Voiding…' : 'Void invoice'}</Text>
            </Pressable>
          ) : null}
          {actions.includes('deleteDraft') ? (
            <Pressable accessibilityRole="button" disabled={disabled} onPress={deleteDraft} style={[styles.secondaryBtn, disabled && styles.disabled]}>
              <Icon name="delete" size={16} color={m3.onSurface} />
              <Text style={styles.secondaryBtnText}>{busy === 'delete' ? 'Deleting…' : 'Delete draft'}</Text>
            </Pressable>
          ) : null}
          {invoice.customer ? (
            <Pressable accessibilityRole="button" disabled={disabled} onPress={() => navigation.navigate('CustomerProfile', { customerId: invoice.customer!.id })} style={[styles.ghostBtn, disabled && styles.disabled]}>
              <Icon name="person" size={16} color={m3.onSurfaceVariant} />
              <Text style={styles.ghostBtnText}>View customer</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  screen: { flex: 1, backgroundColor: m3.surface },
  scrollBody: { paddingHorizontal: m3Space.md, paddingTop: m3Space.sm, paddingBottom: m3Space.xxl, gap: m3Space.md },

  section: { gap: m3Space.xs },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm },
  eyebrow: { ...m3Type.labelSm, color: m3.outline, letterSpacing: 0.4 },
  pageTitle: { ...m3Type.headlineSm, color: m3.onSurface, marginTop: 2 },

  infoCard: { gap: 2 },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 32 },
  infoLabel: { ...m3Type.bodySm, color: m3.onSurfaceVariant, flex: 1 },
  infoValue: { ...m3Type.labelMd, color: m3.onSurface, textAlign: 'right' },

  lineItemsHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lineItemsHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemCount: { ...m3Type.labelSm, color: m3.outline },
  itemsCard: { gap: m3Space.xs },
  item: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm, backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.md, padding: m3Space.sm },
  itemDesc: { ...m3Type.labelLg, color: m3.onSurface },
  itemMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
  itemTotal: { ...m3Type.labelLg, color: m3.onSurface },
  muted: { ...m3Type.bodyMd, color: m3.onSurfaceVariant },

  totalsCard: { gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  rowLabel: { ...m3Type.bodyMd, color: m3.onSurfaceVariant },
  rowValue: { ...m3Type.bodyMd, color: m3.onSurface },
  totalBox: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: m3.surfaceContainerLow, borderRadius: m3Radius.md, padding: m3Space.sm, marginTop: 6 },
  totalLabel: { ...m3Type.labelMd, color: m3.primary, textTransform: 'uppercase' },
  totalValue: { ...m3Type.headlineSm, color: m3.primary },

  body: { ...m3Type.bodyMd, color: m3.onSurface },
  error: { ...m3Type.bodySm, color: m3.error },

  actions: { gap: m3Space.xs },
  primaryBtn: { height: 48, borderRadius: m3Radius.md, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  primaryBtnText: { ...m3Type.labelLg, color: m3.onPrimary },
  secondaryBtn: { height: 48, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  secondaryBtnText: { ...m3Type.labelLg, color: m3.onSurface },
  ghostBtn: { height: 48, borderRadius: m3Radius.md, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 },
  ghostBtnText: { ...m3Type.labelLg, color: m3.onSurfaceVariant },
  disabled: { opacity: 0.5 },
});
