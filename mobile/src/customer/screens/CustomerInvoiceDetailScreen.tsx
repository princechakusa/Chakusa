import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { CustomerInvoiceDetailDto } from '../../apiTypes';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { formatDate, formatMoney } from '../../utils/format';
import { canPayCustomerInvoice, customerInvoiceDetailNote, customerInvoiceHeadline, customerInvoicePaymentLabel, customerInvoiceStatusLabel, isCustomerInvoiceOverdue } from '../domain/customerInvoices';
import { customerInvoicesApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type DetailRoute = RouteProp<CustomerRootStackParamList, 'CustomerInvoiceDetail'>;

const NEUTRAL_STATUSES = new Set(['Paid', 'Won', 'Active']);
const ATTENTION_STATUSES = new Set(['Overdue', 'Cancelled', 'Void']);

// PROGRAM 3 / Invoicing I7 + I8: a single invoice a business sent this
// customer. Read-only except a secure "Pay" action (Stripe Checkout) when
// the invoice is still open and money is owed.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function StatusPill({ label }: { label: string }) {
  const tone = NEUTRAL_STATUSES.has(label) ? 'positive' : ATTENTION_STATUSES.has(label) ? 'danger' : 'attention';
  return (
    <View style={[styles.pill, tone === 'positive' && styles.pillPositive, tone === 'danger' && styles.pillDanger, tone === 'attention' && styles.pillAttention]}>
      <Text style={[styles.pillText, tone === 'positive' && styles.pillTextPositive, tone === 'danger' && styles.pillTextDanger, tone === 'attention' && styles.pillTextAttention]}>{label}</Text>
    </View>
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

function Divider() {
  return <View style={styles.divider} />;
}

function SectionLabel({ title }: { title: string }) {
  return <Text style={styles.sectionLabel}>{title}</Text>;
}

function PrimaryBtn({ label, icon, disabled, onPress }: { label: string; icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryBtn, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      {icon ? <Ionicons name={icon} size={17} color={authColors.onCoral} /> : null}
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

export function CustomerInvoiceDetailScreen() {
  const route = useRoute<DetailRoute>();
  const { invoiceId } = route.params;
  const [invoice, setInvoice] = useState<CustomerInvoiceDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [paying, setPaying] = useState(false);

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

  const pay = useCallback(async () => {
    if (paying) return;
    setPaying(true);
    try {
      const { checkoutUrl } = await customerInvoicesApi.pay(invoiceId);
      await Linking.openURL(checkoutUrl);
    } catch (caught) {
      Alert.alert('Couldn’t start the payment', caught instanceof ApiError ? caught.message : 'Please try again.');
    } finally {
      setPaying(false);
    }
  }, [invoiceId, paying]);

  if (!loaded) return <Screen backgroundColor={authColors.bg}><LoadingState label="Loading invoice…" /></Screen>;
  if (error && !invoice) return <Screen backgroundColor={authColors.bg}><ErrorState message={error} onRetry={() => void load()} /></Screen>;
  if (!invoice) return <Screen backgroundColor={authColors.bg}><EmptyState icon="receipt-outline" title="Invoice not found" message="This invoice is no longer available." /></Screen>;

  const overdue = isCustomerInvoiceOverdue(invoice);
  const revision = invoice.revision;

  return (
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>{invoice.business.name.toUpperCase()}</Text>
          <Text style={styles.title}>{invoice.invoiceNumber}</Text>
          <Text style={styles.subtitle}>{customerInvoiceHeadline(invoice.status)}</Text>
        </View>
        <StatusPill label={customerInvoiceStatusLabel(invoice.status, overdue)} />
      </View>

      <View style={styles.noteCard}>
        <Text style={styles.note}>{customerInvoiceDetailNote(invoice.status, overdue)}</Text>
      </View>

      <View style={styles.card}>
        <InfoRow label="From" value={invoice.business.name} />
        <InfoRow label="Currency" value={invoice.currency} />
        {invoice.issueDate ? <InfoRow label="Issued" value={formatDate(invoice.issueDate)} /> : null}
        {invoice.dueDate ? <InfoRow label="Due" value={formatDate(invoice.dueDate)} /> : null}
      </View>

      <SectionLabel title="Line items" />
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
          {Number(invoice.payment.amountPaid) > 0 ? <InfoRow label="Paid" value={`−${formatMoney(invoice.payment.amountPaid, invoice.currency)}`} /> : null}
          {Number(invoice.payment.amountPaid) > 0 ? <InfoRow label="Amount due" value={formatMoney(invoice.payment.outstandingBalance, invoice.currency)} /> : null}
        </View>
      ) : null}

      {customerInvoicePaymentLabel(invoice.payment) ? (
        <Text style={styles.payStatus}>{customerInvoicePaymentLabel(invoice.payment)}</Text>
      ) : null}

      {canPayCustomerInvoice(invoice) ? (
        <View style={styles.payWrap}>
          <PrimaryBtn
            icon="card-outline"
            disabled={paying}
            label={paying ? 'Opening secure checkout…' : `Pay ${formatMoney(invoice.payment.outstandingBalance, invoice.currency)}`}
            onPress={() => void pay()}
          />
          <Text style={styles.payNote}>You’ll be taken to Stripe to pay securely. Chakusa never sees your card details.</Text>
        </View>
      ) : null}

      {revision?.notes ? (
        <>
          <SectionLabel title="Notes" />
          <View style={styles.card}><Text style={styles.body}>{revision.notes}</Text></View>
        </>
      ) : null}
      {revision?.terms ? (
        <>
          <SectionLabel title="Terms" />
          <View style={styles.card}><Text style={styles.body}>{revision.terms}</Text></View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: authSpace.sm, marginBottom: authSpace.sm },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  pill: { paddingHorizontal: authSpace.sm, paddingVertical: 4, borderRadius: authRadius.pill, backgroundColor: authColors.coralSoft },
  pillText: { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: authColors.coral },
  pillPositive: { backgroundColor: '#EAF9F1' },
  pillTextPositive: { color: authColors.positive },
  pillDanger: { backgroundColor: '#FDECEC' },
  pillTextDanger: { color: authColors.danger },
  pillAttention: { backgroundColor: '#FDF3E4' },
  pillTextAttention: { color: '#B7791F' },
  sectionLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: authColors.ink, marginTop: authSpace.md, marginBottom: authSpace.xs },
  noteCard: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, padding: authSpace.md, marginBottom: authSpace.sm, ...authShadow.card },
  note: { ...authType.body, fontSize: 12 },
  payStatus: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink, textAlign: 'center', marginTop: authSpace.sm },
  payWrap: { marginTop: authSpace.sm, gap: authSpace.xs },
  payNote: { ...authType.body, fontSize: 12, textAlign: 'center' },
  card: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, paddingHorizontal: authSpace.md, paddingVertical: authSpace.xs, ...authShadow.card },
  infoRow: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  infoLabel: { ...authType.body, fontSize: 13 },
  infoValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: authColors.ink },
  divider: { height: 1, backgroundColor: authColors.lineSoft },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: authSpace.sm, gap: authSpace.sm },
  lineMain: { flex: 1 },
  lineDesc: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  lineMeta: { ...authType.body, fontSize: 12, marginTop: 2 },
  lineTotal: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  body: { ...authType.body, fontSize: 14, color: authColors.ink, paddingVertical: authSpace.sm },
  muted: { ...authType.body, fontSize: 14, paddingVertical: authSpace.sm },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs, minHeight: 52, borderRadius: authRadius.pill, backgroundColor: authColors.coral, ...authShadow.cta },
  primaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.onCoral },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
