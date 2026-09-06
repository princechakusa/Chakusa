import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  invoiceErrorViewState,
  invoiceStateDetail,
  invoiceStateHeadline,
  isInvoiceOverdue,
  viewStateFromInvoiceResponse,
  type PublicInvoiceViewState,
} from '../domain/publicInvoice';
import { ApiError } from '../services/api';
import { publicInvoicesApi } from '../services/publicInvoices';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { formatDate, formatMoney } from '../utils/format';

export function PublicInvoiceScreen({ token }: { token: string | null }) {
  const [view, setView] = useState<PublicInvoiceViewState>(token ? { kind: 'loading' } : { kind: 'invalid' });

  const load = useCallback(async () => {
    if (!token) {
      setView({ kind: 'invalid' });
      return;
    }
    setView({ kind: 'loading' });
    try {
      setView(viewStateFromInvoiceResponse(await publicInvoicesApi.get(token)));
    } catch (error) {
      setView(invoiceErrorViewState(error instanceof ApiError ? error.kind : 'network'));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const details = view.kind === 'ready' ? view.details : null;
  const overdue = details ? isInvoiceOverdue(details) : false;

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.shell}>
        <Text style={styles.brand}>CHAKUSA</Text>
        <View style={styles.card} accessibilityLiveRegion="polite">
          {view.kind === 'loading' ? (
            <State icon="hourglass-outline" title="Loading…">
              <ActivityIndicator color={colors.primary} accessibilityLabel="Loading invoice" />
            </State>
          ) : null}
          {view.kind === 'network-error' ? (
            <State icon="cloud-offline-outline" title="We couldn’t load this page" body="Check your connection and try again.">
              <Action label="Try again" onPress={() => void load()} />
            </State>
          ) : null}
          {view.kind === 'invalid' ? (
            <State icon="link-outline" title="This link is unavailable." body="Please check the link you received, or contact the business directly." />
          ) : null}

          {details ? (
            <View style={styles.body}>
              <Text style={styles.business}>{details.business.name}</Text>
              <Text style={styles.docNumber}>INVOICE · {details.invoiceNumber}</Text>
              <Text style={styles.headline}>{invoiceStateHeadline(details.state)}</Text>
              {invoiceStateDetail(details.state, overdue) ? (
                <Text style={styles.stateDetail}>{invoiceStateDetail(details.state, overdue)}</Text>
              ) : null}
              <View style={styles.dates}>
                {details.issueDate ? <Text style={styles.dateText}>Issued {formatDate(details.issueDate)}</Text> : null}
                {details.dueDate ? (
                  <Text style={[styles.dateText, overdue && styles.overdue]}>Due {formatDate(details.dueDate)}{overdue ? ' · overdue' : ''}</Text>
                ) : null}
              </View>

              <View style={styles.lines}>
                {details.revision.lineItems.length === 0 ? (
                  <Text style={styles.muted}>No line items.</Text>
                ) : (
                  details.revision.lineItems.map((li, index) => (
                    <View key={index} style={[styles.lineRow, index > 0 && styles.lineDivider]}>
                      <View style={styles.lineMain}>
                        <Text style={styles.lineDesc}>{li.description}</Text>
                        <Text style={styles.lineMeta}>
                          {li.quantity} × {formatMoney(li.unitPrice, details.currency)}
                          {li.discountAmount !== '0.00' ? ` · −${formatMoney(li.discountAmount, details.currency)}` : ''}
                        </Text>
                      </View>
                      <Text style={styles.lineTotal}>{formatMoney(li.lineTotal, details.currency)}</Text>
                    </View>
                  ))
                )}
              </View>

              <View style={styles.totals}>
                <TotalRow label="Subtotal" value={formatMoney(details.revision.totals.subtotal, details.currency)} />
                {details.revision.totals.discountTotal !== '0.00' ? (
                  <TotalRow label="Discount" value={`−${formatMoney(details.revision.totals.discountTotal, details.currency)}`} />
                ) : null}
                {details.revision.totals.taxTotal !== '0.00' ? (
                  <TotalRow label="Tax" value={formatMoney(details.revision.totals.taxTotal, details.currency)} />
                ) : null}
                <TotalRow label="Total" value={formatMoney(details.revision.totals.total, details.currency)} strong />
              </View>

              {details.revision.notes ? (
                <View style={styles.block}>
                  <Text style={styles.blockLabel}>Notes</Text>
                  <Text style={styles.blockText}>{details.revision.notes}</Text>
                </View>
              ) : null}
              {details.revision.terms ? (
                <View style={styles.block}>
                  <Text style={styles.blockLabel}>Terms</Text>
                  <Text style={styles.blockText}>{details.revision.terms}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        <Text style={styles.footer}>Invoices powered by Chakusa</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function State({ icon, title, body, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <View style={styles.state}>
      <Ionicons name={icon} size={42} color={colors.primary} />
      <Text style={styles.headline}>{title}</Text>
      {body ? <Text style={styles.stateDetail}>{body}</Text> : null}
      {children}
    </View>
  );
}

function Action({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.totalRow}>
      <Text style={[styles.totalLabel, strong && styles.totalStrong]}>{label}</Text>
      <Text style={[styles.totalValue, strong && styles.totalStrong]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  shell: { width: '100%', maxWidth: 560, alignSelf: 'center', padding: spacing.lg, gap: spacing.md },
  brand: { ...typography.micro, color: colors.primary, letterSpacing: 2, textAlign: 'center', marginBottom: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, ...shadows.card },
  body: { gap: spacing.sm },
  state: { alignItems: 'center', gap: spacing.md },
  business: { ...typography.heading, color: colors.text, textAlign: 'center' },
  docNumber: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  headline: { ...typography.subheading, color: colors.text, textAlign: 'center', marginTop: spacing.xs },
  stateDetail: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  dates: { alignItems: 'center', gap: 2, marginTop: spacing.xs },
  dateText: { ...typography.caption, color: colors.textSecondary },
  overdue: { color: colors.negative, fontWeight: '700' },
  lines: { marginTop: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  lineRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, padding: spacing.md },
  lineDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  lineMain: { flex: 1 },
  lineDesc: { ...typography.bodyStrong, color: colors.text },
  lineMeta: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  lineTotal: { ...typography.bodyStrong, color: colors.text },
  muted: { ...typography.body, color: colors.textSecondary, padding: spacing.md },
  totals: { marginTop: spacing.sm, gap: spacing.xs },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { ...typography.body, color: colors.textSecondary },
  totalValue: { ...typography.body, color: colors.text },
  totalStrong: { ...typography.bodyStrong, color: colors.text },
  block: { marginTop: spacing.md, gap: spacing.xs },
  blockLabel: { ...typography.caption, color: colors.text },
  blockText: { ...typography.body, color: colors.textSecondary },
  action: { minHeight: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  actionText: { ...typography.bodyStrong, color: colors.surface },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
  footer: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
});
