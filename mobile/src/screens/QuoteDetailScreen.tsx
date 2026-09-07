import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { QuoteDetailDto } from '../apiTypes';
import { AppHeader, Divider, EmptyState, ErrorState, InfoRow, LoadingState, PrimaryButton, Screen, SecondaryButton, SectionHeader, StatusBadge } from '../components/ui';
import { availableQuoteActions, documentTypeLabel, quoteStatusLabel, type BusinessRole } from '../domain/quotes';
import { ApiError } from '../services/api';
import { quotesApi } from '../services/endpoints';
import { copyMessage } from '../services/messaging';
import { useAuth } from '../state/AuthContext';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { formatDate, formatMoney } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'QuoteDetail'>;

function normalizeRole(role: string | null): BusinessRole {
  return role === 'OWNER' || role === 'ADMIN' ? role : 'STAFF';
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

  if (loading && !quote) return <Screen><LoadingState label="Loading quote…" /></Screen>;
  if (error && !quote) return <Screen><ErrorState message={error} onRetry={() => void load()} /></Screen>;
  if (!quote) return <Screen><EmptyState title="Quote not found" message="This quote is no longer available." icon="document-text-outline" /></Screen>;

  const revision = quote.currentRevision;
  const disabled = Boolean(busy);

  return (
    <Screen>
      <AppHeader
        eyebrow={documentTypeLabel(quote.documentType).toUpperCase()}
        title={quote.documentNumber}
        subtitle={quote.customer?.name ?? quote.lead?.serviceRequested ?? 'No customer linked'}
        right={<StatusBadge label={quoteStatusLabel(quote.status)} />}
      />

      <View style={styles.card}>
        <InfoRow label="Status" value={quoteStatusLabel(quote.status)} />
        <InfoRow label="Currency" value={quote.currency} />
        {quote.expiresAt ? <InfoRow label="Expires" value={formatDate(quote.expiresAt)} /> : null}
        <InfoRow label="Created" value={formatDate(quote.createdAt)} />
        {revision ? <InfoRow label="Revision" value={`#${revision.revisionNumber}`} /> : null}
      </View>

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
                    {li.quantity} × {formatMoney(li.unitPrice, quote.currency)}
                    {li.discountAmount !== '0.00' ? ` · −${formatMoney(li.discountAmount, quote.currency)}` : ''}
                    {li.taxable ? ' · taxable' : ''}
                  </Text>
                </View>
                <Text style={styles.lineTotal}>{formatMoney(li.lineTotal, quote.currency)}</Text>
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
          <InfoRow label="Subtotal" value={formatMoney(revision.totals.subtotal, quote.currency)} />
          {revision.totals.discountTotal !== '0.00' ? <InfoRow label="Discount" value={`−${formatMoney(revision.totals.discountTotal, quote.currency)}`} /> : null}
          {revision.totals.taxTotal !== '0.00' ? <InfoRow label="Tax" value={formatMoney(revision.totals.taxTotal, quote.currency)} /> : null}
          <Divider />
          <InfoRow label="Total" value={formatMoney(revision.totals.total, quote.currency)} />
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

      {quote.revisionHistory.length > 1 ? (
        <>
          <SectionHeader title="Revision history" />
          <View style={styles.card}>
            {quote.revisionHistory.map((entry) => (
              <InfoRow key={entry.id} label={`#${entry.revisionNumber} · ${formatDate(entry.createdAt)}`} value={formatMoney(entry.total, quote.currency)} />
            ))}
          </View>
        </>
      ) : null}

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      <View style={styles.actions}>
        {actions.includes('editDraft') ? (
          <PrimaryButton disabled={disabled} fullWidth icon="create-outline" label="Edit draft" onPress={() => navigation.navigate('QuoteEditor', { quoteId: quote.id })} />
        ) : null}
        {actions.includes('send') ? (
          <PrimaryButton disabled={disabled} fullWidth icon="send-outline" label={busy === 'send' ? 'Sending…' : 'Send quote'} onPress={() => void send()} />
        ) : null}
        {actions.includes('resend') ? (
          <SecondaryButton disabled={disabled} fullWidth icon="link-outline" label={busy === 'resend' ? 'Working…' : 'Share secure link'} onPress={() => void shareLink()} />
        ) : null}
        {actions.includes('revise') ? (
          <SecondaryButton disabled={disabled} fullWidth icon="git-branch-outline" label="Revise quote" onPress={() => navigation.navigate('QuoteEditor', { quoteId: quote.id, mode: 'revise' })} />
        ) : null}
        {actions.includes('cancel') ? (
          <SecondaryButton disabled={disabled} fullWidth icon="close-circle-outline" label={busy === 'cancel' ? 'Canceling…' : 'Cancel quote'} onPress={cancel} />
        ) : null}
        {actions.includes('deleteDraft') ? (
          <SecondaryButton disabled={disabled} fullWidth icon="trash-outline" label={busy === 'delete' ? 'Deleting…' : 'Delete draft'} onPress={deleteDraft} />
        ) : null}
        {quote.customer ? (
          <SecondaryButton disabled={disabled} fullWidth icon="person-outline" label="View customer" onPress={() => navigation.navigate('CustomerProfile', { customerId: quote.customer!.id })} />
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
