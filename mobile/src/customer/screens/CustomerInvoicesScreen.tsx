import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, LoadingState, Screen, StatusBadge } from '../../components/ui';
import type { CustomerInvoiceListItemDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDate, formatMoney } from '../../utils/format';
import { customerInvoiceStatusLabel, isCustomerInvoiceOverdue, outstandingInvoiceCount, sortCustomerInvoices } from '../domain/customerInvoices';
import { customerInvoicesApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;

// PROGRAM 3 / Invoicing I7: the customer's invoice inbox. Read-only —
// invoices a linked business has sent. No pay action (no payment flow
// exists yet).

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
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader
        eyebrow="INVOICES"
        title="Your invoices"
        subtitle={outstanding > 0 ? `${outstanding} outstanding` : 'Invoices your businesses have sent you'}
      />

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
                  <StatusBadge label={customerInvoiceStatusLabel(invoice.status, overdue)} />
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.primary} />
              </Pressable>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  pressed: { opacity: 0.78 },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  alignEnd: { alignItems: 'flex-end', gap: 4 },
  name: { ...typography.bodyStrong, color: colors.text },
  meta: { ...typography.caption, color: colors.textSecondary },
  metaOverdue: { color: colors.negative },
  total: { ...typography.bodyStrong, color: colors.text },
});
