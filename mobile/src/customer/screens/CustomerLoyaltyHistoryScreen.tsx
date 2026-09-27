import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { LoyaltyTransactionDto } from '../../apiTypes';
import { groupTransactionsByMonth, transactionLabel } from '../../domain/loyalty';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { formatDate } from '../../utils/format';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerLoyaltyHistory'>;

// PROGRAM 2 LOOP 8: points history for one business. Paginated via the
// server cursor. Signs are shown plainly (+120 / -500 points); never
// "deposit" / "withdrawal" / "balance".
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function SecondaryBtn({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.secondaryBtn, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

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
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>POINTS HISTORY</Text>
        <Text style={styles.title}>{businessName ?? 'Points history'}</Text>
      </View>

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
              <SecondaryBtn label={loadingMore ? 'Loading…' : 'Load more'} disabled={loadingMore} onPress={() => { setLoadingMore(true); void load(cursor); }} />
            ) : null}
          </View>
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  groups: { gap: authSpace.md },
  group: { gap: authSpace.xs },
  month: { ...authType.body, fontSize: 12 },
  card: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, paddingHorizontal: authSpace.md, ...authShadow.card },
  row: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, paddingVertical: authSpace.sm, borderBottomWidth: 1, borderBottomColor: authColors.lineSoft },
  copy: { flex: 1, minWidth: 0 },
  label: { ...authType.body, fontSize: 13, color: authColors.ink },
  meta: { ...authType.micro, textTransform: 'none', letterSpacing: 0, fontSize: 11, marginTop: 2 },
  delta: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.positive },
  deltaNegative: { color: authColors.ink },
  secondaryBtn: { minHeight: 52, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface, alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.ink },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
