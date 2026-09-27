import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { CustomerInvoiceListItemDto } from '../../apiTypes';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { formatDate, formatMoney } from '../../utils/format';
import { customerInvoiceStatusLabel, isCustomerInvoiceOverdue, outstandingInvoiceCount, sortCustomerInvoices } from '../domain/customerInvoices';
import { customerInvoicesApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;

const NEUTRAL_STATUSES = new Set(['Paid', 'Won', 'Active']);
const ATTENTION_STATUSES = new Set(['Overdue', 'Cancelled', 'Void']);

// PROGRAM 3 / Invoicing I7: the customer's invoice inbox. Read-only -
// invoices a linked business has sent. No pay action (no payment flow
// exists yet).
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

export function CustomerInvoicesScreen() {
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<CustomerInvoiceListItemDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await customerInvoicesApi.list();
      setItems(response.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load your invoices.');
    } finally {
      setLoaded(true);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const sorted = sortCustomerInvoices(items);
  const outstanding = outstandingInvoiceCount(items);

  return (
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>INVOICES</Text>
        <Text style={styles.title}>Your invoices</Text>
        <Text style={styles.subtitle}>{outstanding > 0 ? `${outstanding} outstanding` : 'Invoices your businesses have sent you'}</Text>
      </View>

      {!loaded ? (
        <LoadingState label="Loading your invoices…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !sorted.length ? (
        <EmptyState
          icon="receipt-outline"
          title="No invoices yet"
          message="When a business you're connected with sends you an invoice, it will appear here."
        />
      ) : (
        <View style={styles.list}>
          {sorted.map((invoice) => {
            const overdue = isCustomerInvoiceOverdue(invoice);
            return (
              <Pressable
                key={invoice.id}
                accessibilityRole="button"
                accessibilityLabel={`Invoice ${invoice.invoiceNumber} from ${invoice.business.name}, ${customerInvoiceStatusLabel(invoice.status, overdue)}`}
                onPress={() => navigation.navigate('CustomerInvoiceDetail', { invoiceId: invoice.id })}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.copy}>
                  <Text style={styles.name}>{invoice.business.name}</Text>
                  <Text style={styles.meta}>{invoice.invoiceNumber}</Text>
                  <Text style={[styles.meta, overdue && styles.metaOverdue]}>
                    {invoice.dueDate ? `Due ${formatDate(invoice.dueDate)}` : `Sent ${formatDate(invoice.issueDate ?? invoice.createdAt)}`}
                  </Text>
                </View>
                <View style={styles.alignEnd}>
                  <Text style={styles.total}>{formatMoney(invoice.total, invoice.currency)}</Text>
                  <StatusPill label={customerInvoiceStatusLabel(invoice.status, overdue)} />
                </View>
                <Ionicons name="chevron-forward" size={16} color={authColors.coral} />
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  list: { gap: authSpace.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, padding: authSpace.md, backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, ...authShadow.card },
  pressed: { opacity: 0.78 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  alignEnd: { alignItems: 'flex-end', gap: 4 },
  name: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  meta: { ...authType.body, fontSize: 12 },
  metaOverdue: { color: authColors.danger },
  total: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  pill: { paddingHorizontal: authSpace.xs, paddingVertical: 3, borderRadius: authRadius.pill, backgroundColor: authColors.coralSoft },
  pillText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: authColors.coral },
  pillPositive: { backgroundColor: '#EAF9F1' },
  pillTextPositive: { color: authColors.positive },
  pillDanger: { backgroundColor: '#FDECEC' },
  pillTextDanger: { color: authColors.danger },
  pillAttention: { backgroundColor: '#FDF3E4' },
  pillTextAttention: { color: '#B7791F' },
});
