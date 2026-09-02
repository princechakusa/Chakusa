import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, LoadingState, Screen, SecondaryButton } from '../../components/ui';
import type { LoyaltyTransactionDto } from '../../apiTypes';
import { groupTransactionsByMonth, transactionLabel } from '../../domain/loyalty';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDate } from '../../utils/format';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerLoyaltyHistory'>;

// PROGRAM 2 LOOP 8: points history for one business. Paginated via the
// server cursor. Signs are shown plainly (+120 / -500 points); never
// "deposit" / "withdrawal" / "balance".

export function CustomerLoyaltyHistoryScreen({ route }: Props) {
  const { businessId, businessName } = route.params;
  const [items, setItems] = useState<LoyaltyTransactionDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (nextCursor?: string) => {
    try {
      const page = await loyaltyApi.transactions(businessId, { cursor: nextCursor, limit: 25 });
      setItems((current) => (nextCursor ? [...current, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load your points history.');
    } finally {
      setLoaded(true);
      setLoadingMore(false);
    }
  }, [businessId]);

  useEffect(() => { void load(); }, [load]);

  const groups = groupTransactionsByMonth(items);

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow="POINTS HISTORY" title={businessName ?? 'Points history'} />

      {!loaded ? <LoadingState label="Loading history…" />
        : error && !items.length ? <ErrorState message={error} onRetry={() => void load()} />
        : !items.length ? <EmptyState icon="time-outline" title="No activity yet" message="Points you earn or use with this business will be listed here." />
        : (
          <View style={styles.groups}>
            {groups.map((group) => (
              <View key={group.month} style={styles.group}>
                <Text style={styles.month}>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(`${group.month}-01T00:00:00`))}</Text>
                <View style={styles.card}>
                  {group.items.map((txn) => (
                    <View key={txn.id} style={styles.row}>
                      <View style={styles.copy}>
                        <Text style={styles.label}>{txn.reason ?? transactionLabel(txn)}</Text>
                        <Text style={styles.meta}>{formatDate(txn.createdAt)} · balance {txn.balanceAfter.toLocaleString('en-US')} pts</Text>
                      </View>
                      <Text style={[styles.delta, txn.points < 0 && styles.deltaNegative]}>
                        {txn.points >= 0 ? '+' : ''}{txn.points.toLocaleString('en-US')} pts
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
            {cursor ? (
              <SecondaryButton fullWidth label={loadingMore ? 'Loading…' : 'Load more'} disabled={loadingMore} onPress={() => { setLoadingMore(true); void load(cursor); }} />
            ) : null}
          </View>
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  groups: { gap: spacing.md },
  group: { gap: spacing.xs },
  month: { ...typography.caption, color: colors.textSecondary },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  copy: { flex: 1, minWidth: 0 },
  label: { ...typography.caption, color: colors.text },
  meta: { ...typography.micro, color: colors.tabInactive, marginTop: 2 },
  delta: { ...typography.bodyStrong, color: colors.success },
  deltaNegative: { color: colors.text },
});
