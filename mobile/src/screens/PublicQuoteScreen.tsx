import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  canActOnQuote,
  documentTypeNoun,
  quoteErrorViewState,
  quoteStateDetail,
  quoteStateHeadline,
  viewStateFromQuoteResponse,
  type PublicQuoteViewState,
} from '../domain/publicQuote';
import { ApiError } from '../services/api';
import { publicQuotesApi } from '../services/publicQuotes';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { formatDate, formatMoney } from '../utils/format';

export function PublicQuoteScreen({ token }: { token: string | null }) {
  const [view, setView] = useState<PublicQuoteViewState>(token ? { kind: 'loading' } : { kind: 'invalid' });
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setView({ kind: 'invalid' });
      return;
    }
    setView({ kind: 'loading' });
    try {
      setView(viewStateFromQuoteResponse(await publicQuotesApi.get(token)));
    } catch (error) {
      setView(quoteErrorViewState(error instanceof ApiError ? error.kind : 'network'));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: 'accept' | 'decline') => {
    if (!token || !canActOnQuote(view)) return;
    const details = view.details;
    setView({ kind: 'acting', details, action });
    try {
      const trimmed = note.trim() || undefined;
      const response = action === 'accept' ? await publicQuotesApi.accept(token, trimmed) : await publicQuotesApi.decline(token, trimmed);
      setView(viewStateFromQuoteResponse(response));
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.kind === 'conflict')) {
        // The quote moved on (revised / canceled / expired / already actioned) - reload to show the truth.
        await load();
      } else {
        setView(quoteErrorViewState(error instanceof ApiError ? error.kind : 'network'));
      }
    }
  };

  const details = view.kind === 'ready' || view.kind === 'acting' ? view.details : null;
  const acting = view.kind === 'acting';

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.shell}>
        <Text style={styles.brand}>CHAKUSA</Text>
        <View style={styles.card} accessibilityLiveRegion="polite">
          {view.kind === 'loading' ? (
            <State icon="hourglass-outline" title="Loading…">
              <ActivityIndicator color={colors.primary} accessibilityLabel="Loading quote" />
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
              <Text style={styles.docNumber}>
                {documentTypeNoun(details.documentType).toUpperCase()} · {details.documentNumber}
              </Text>
              <Text style={styles.headline}>{quoteStateHeadline(details.state, details.documentType)}</Text>
              {quoteStateDetail(details.state) ? <Text style={styles.stateDetail}>{quoteStateDetail(details.state)}</Text> : null}
              {details.expiresAt ? <Text style={styles.expiry}>Valid until {formatDate(details.expiresAt)}</Text> : null}

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

              {details.state === 'open' ? (
                <View style={styles.actions}>
                  <Text style={styles.label}>
                    Add a note <Text style={styles.optional}>(optional)</Text>
                  </Text>
                  <TextInput
                    accessibilityLabel="Optional note for the business"
                    editable={!acting}
                    maxLength={2000}
                    multiline
                    onChangeText={setNote}
                    placeholder="Anything you’d like the business to know…"
                    placeholderTextColor={colors.tabInactive}
                    style={styles.input}
                    value={note}
                  />
                  <Action disabled={acting} label={acting && view.action === 'accept' ? 'Accepting…' : 'Accept'} onPress={() => void act('accept')} />
                  <Action variant="secondary" disabled={acting} label={acting && view.action === 'decline' ? 'Declining…' : 'Decline'} onPress={() => void act('decline')} />
                  <Text style={styles.disclaimer}>Accepting records that you’d like to proceed. It is not a signature or a payment.</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
        <Text style={styles.footer}>Quotes powered by Chakusa</Text>
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

function Action({ label, onPress, disabled = false, variant = 'primary' }: { label: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        variant === 'secondary' && styles.actionSecondary,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.actionText, variant === 'secondary' && styles.actionTextSecondary]}>{label}</Text>
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
  expiry: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
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
  actions: { marginTop: spacing.lg, gap: spacing.sm },
  label: { ...typography.caption, color: colors.text },
  optional: { color: colors.textSecondary },
  input: { minHeight: 96, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, color: colors.text, ...typography.body, textAlignVertical: 'top' },
  action: { minHeight: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },
  actionSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  actionText: { ...typography.bodyStrong, color: colors.surface },
  actionTextSecondary: { color: colors.text },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
  disclaimer: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  footer: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
});
