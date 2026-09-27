import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { QuoteDetailDto } from '../apiTypes';
import { availableQuoteActions, documentTypeLabel, quoteStatusLabel, type BusinessRole } from '../domain/quotes';
import { ApiError } from '../services/api';
import { quotesApi } from '../services/endpoints';
import { copyMessage } from '../services/messaging';
import { useAuth } from '../state/AuthContext';
import { RootStackParamList } from '../types';
import { formatDate, formatMoney } from '../utils/format';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Empty, M3Error, M3Header, M3Loading, SectionTitle } from '../experience/businessKit';

type Props = NativeStackScreenProps<RootStackParamList, 'QuoteDetail'>;

function normalizeRole(role: string | null): BusinessRole {
  return role === 'OWNER' || role === 'ADMIN' ? role : 'STAFF';
}

function statusTone(status: QuoteDetailDto['status']): 'secondary' | 'neutral' | 'error' | 'primaryFixed' {
  if (status === 'ACCEPTED') return 'secondary';
  if (status === 'DECLINED' || status === 'CANCELED' || status === 'EXPIRED') return 'error';
  if (status === 'SENT') return 'primaryFixed';
  return 'neutral';
}

export function QuoteDetailScreen({ route, navigation }: Props) {
  const { role } = useAuth();
  const memberRole = normalizeRole(role);
  const [quote, setQuote] = useState<QuoteDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setQuote(await quotesApi.get(route.params.quoteId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to load this quote.');
    } finally {
      setLoading(false);
    }
  }, [route.params.quoteId]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', () => void load());
    return unsub;
  }, [navigation, load]);

  const actions = useMemo(() => (quote ? availableQuoteActions(quote.status, memberRole) : []), [quote, memberRole]);

  const shareLink = async () => {
    if (!quote || busy) return;
    setBusy('resend');
    try {
      const result = await quotesApi.resend(quote.id);
      await copyMessage(result.acceptanceUrl);
      Alert.alert('Secure link copied', 'A fresh link to this quote is on your clipboard. Any previous link is now inactive.');
      await load();
    } catch (caught) {
      Alert.alert('Couldn’t create a link', caught instanceof ApiError ? caught.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!quote || busy) return;
    setBusy('send');
    try {
      const result = await quotesApi.send(quote.id, quote.currentRevision?.id);
      await copyMessage(result.acceptanceUrl);
      Alert.alert('Quote sent', 'A secure link is on your clipboard - share it with your customer however you like.');
      await load();
    } catch (caught) {
      Alert.alert('Couldn’t send this quote', caught instanceof ApiError ? caught.message : 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const cancel = () => {
    if (!quote || busy) return;
    Alert.alert('Cancel this quote?', 'The customer will no longer be able to accept it. This cannot be undone.', [
      { text: 'Keep quote', style: 'cancel' },
      {
        text: 'Cancel quote',
        style: 'destructive',
        onPress: async () => {
          setBusy('cancel');
          try {
            setQuote(await quotesApi.cancel(quote.id));
          } catch (caught) {
            Alert.alert('Couldn’t cancel', caught instanceof ApiError ? caught.message : 'Please try again.');
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  const deleteDraft = () => {
    if (!quote || busy) return;
    Alert.alert('Delete this draft?', 'This draft quote will be permanently removed.', [
      { text: 'Keep draft', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          try {
            await quotesApi.remove(quote.id);
            navigation.goBack();
          } catch (caught) {
            Alert.alert('Couldn’t delete', caught instanceof ApiError ? caught.message : 'Please try again.');
            setBusy(null);
          }
        },
      },
    ]);
  };

  if (loading && !quote) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        <M3Header businessName="Quote" onBack={() => navigation.goBack()} />
        <M3Loading label="Loading quote…" />
      </SafeAreaView>
    );
  }
  if (error && !quote) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        <M3Header businessName="Quote" onBack={() => navigation.goBack()} />
        <M3Error message={error} onRetry={() => void load()} />
      </SafeAreaView>
    );
  }
  if (!quote) {
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        <M3Header businessName="Quote" onBack={() => navigation.goBack()} />
        <M3Empty icon="receipt_long" title="Quote not found" message="This quote is no longer available." />
      </SafeAreaView>
    );
  }

  const revision = quote.currentRevision;
  const disabled = Boolean(busy);

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <M3Header businessName={quote.documentNumber} onBack={() => navigation.goBack()} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.scrollBody} showsVerticalScrollIndicator={false}>
        <View style={styles.section}>
          <View style={styles.titleRow}>
                <View style={styles.flex}>
                  <Text style={styles.eyebrow}>{documentTypeLabel(quote.documentType).toUpperCase()}</Text>
                  <Text style={styles.pageTitle}>{quote.customer?.name ?? quote.lead?.serviceRequested ?? 'No customer linked'}</Text>
                </View>
                <Chip label={quoteStatusLabel(quote.status)} tone={statusTone(quote.status)} />
              </View>

              <M3Card style={styles.infoCard}>
                <InfoRow label="Status" value={quoteStatusLabel(quote.status)} />
                <InfoRow label="Currency" value={quote.currency} />
                {quote.expiresAt ? <InfoRow label="Expires" value={formatDate(quote.expiresAt)} /> : null}
                <InfoRow label="Created" value={formatDate(quote.createdAt)} />
                {revision ? <InfoRow label="Revision" value={`#${revision.revisionNumber}`} /> : null}
              </M3Card>

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
                            {li.quantity} × {formatMoney(li.unitPrice, quote.currency)}
                            {li.discountAmount !== '0.00' ? ` · −${formatMoney(li.discountAmount, quote.currency)}` : ''}
                            {li.taxable ? ' · taxable' : ''}
                          </Text>
                        </View>
                        <Text style={styles.itemTotal}>{formatMoney(li.lineTotal, quote.currency)}</Text>
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
                  <Row label="Subtotal" value={formatMoney(revision.totals.subtotal, quote.currency)} />
                  {revision.totals.discountTotal !== '0.00' ? <Row label="Discount" value={`−${formatMoney(revision.totals.discountTotal, quote.currency)}`} /> : null}
                  {revision.totals.taxTotal !== '0.00' ? <Row label="Tax" value={formatMoney(revision.totals.taxTotal, quote.currency)} /> : null}
                  <View style={styles.totalBox}>
                    <Text style={styles.totalLabel}>Total</Text>
                    <Text style={styles.totalValue}>{formatMoney(revision.totals.total, quote.currency)}</Text>
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

              {quote.revisionHistory.length > 1 ? (
                <View style={styles.section}>
                  <SectionTitle title="Revision history" />
                  <M3Card style={styles.infoCard}>
                    {quote.revisionHistory.map((entry) => (
                      <InfoRow key={entry.id} label={`#${entry.revisionNumber} · ${formatDate(entry.createdAt)}`} value={formatMoney(entry.total, quote.currency)} />
                    ))}
                  </M3Card>
                </View>
              ) : null}

              {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

              <View style={styles.actions}>
                {actions.includes('editDraft') ? (
                  <Pressable accessibilityRole="button" disabled={disabled} onPress={() => navigation.navigate('QuoteEditor', { quoteId: quote.id })} style={[styles.primaryBtn, disabled && styles.disabled]}>
                    <Icon name="edit" size={16} color={m3.onPrimary} />
                    <Text style={styles.primaryBtnText}>Edit draft</Text>
                  </Pressable>
                ) : null}
                {actions.includes('send') ? (
                  <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void send()} style={[styles.primaryBtn, disabled && styles.disabled]}>
                    <Icon name="send" size={16} color={m3.onPrimary} />
                    <Text style={styles.primaryBtnText}>{busy === 'send' ? 'Sending…' : 'Send quote'}</Text>
                  </Pressable>
                ) : null}
                {actions.includes('resend') ? (
                  <Pressable accessibilityRole="button" disabled={disabled} onPress={() => void shareLink()} style={[styles.secondaryBtn, disabled && styles.disabled]}>
                    <Icon name="link" size={16} color={m3.onSurface} />
                    <Text style={styles.secondaryBtnText}>{busy === 'resend' ? 'Working…' : 'Share secure link'}</Text>
                  </Pressable>
                ) : null}
                {actions.includes('revise') ? (
                  <Pressable accessibilityRole="button" disabled={disabled} onPress={() => navigation.navigate('QuoteEditor', { quoteId: quote.id, mode: 'revise' })} style={[styles.secondaryBtn, disabled && styles.disabled]}>
                    <Icon name="call_split" size={16} color={m3.onSurface} />
                    <Text style={styles.secondaryBtnText}>Revise quote</Text>
                  </Pressable>
                ) : null}
                {actions.includes('cancel') ? (
                  <Pressable accessibilityRole="button" disabled={disabled} onPress={cancel} style={[styles.secondaryBtn, disabled && styles.disabled]}>
                    <Icon name="cancel" size={16} color={m3.onSurface} />
                    <Text style={styles.secondaryBtnText}>{busy === 'cancel' ? 'Canceling…' : 'Cancel quote'}</Text>
                  </Pressable>
                ) : null}
                {actions.includes('deleteDraft') ? (
                  <Pressable accessibilityRole="button" disabled={disabled} onPress={deleteDraft} style={[styles.secondaryBtn, disabled && styles.disabled]}>
                    <Icon name="delete" size={16} color={m3.onSurface} />
                    <Text style={styles.secondaryBtnText}>{busy === 'delete' ? 'Deleting…' : 'Delete draft'}</Text>
                  </Pressable>
                ) : null}
                {quote.customer ? (
                  <Pressable accessibilityRole="button" disabled={disabled} onPress={() => navigation.navigate('CustomerProfile', { customerId: quote.customer!.id })} style={[styles.ghostBtn, disabled && styles.disabled]}>
                    <Icon name="person" size={16} color={m3.onSurfaceVariant} />
                    <Text style={styles.ghostBtnText}>View customer</Text>
                  </Pressable>
                ) : null}
              </View>
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
  totalLabel: { ...m3Type.labelMd, color: m3.onSurface },
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
