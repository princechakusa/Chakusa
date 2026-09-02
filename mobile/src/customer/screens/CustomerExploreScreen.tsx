import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, FilterTabs, LoadingState, Screen, SearchBar } from '../../components/ui';
import type { MarketplaceCardDto, MarketplaceCategoryDto } from '../../apiTypes';
import { ApiError } from '../../services/api';
import { colors, spacing, typography } from '../../theme';
import { BusinessCard } from '../components/cards';
import { marketplaceApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;

// PROGRAM 2 LOOP 7: discovery. `/customer/marketplace` for the default
// feed, `/customer/marketplace/search` once the customer types, and the
// category list as quick filters. Read-only browsing — the profile screen
// owns favourite/follow/report.

export function CustomerExploreScreen() {
  const navigation = useNavigation<Nav>();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [categories, setCategories] = useState<MarketplaceCategoryDto[]>([]);
  const [items, setItems] = useState<MarketplaceCardDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    marketplaceApi.categories().then((res) => setCategories(res.categories.slice(0, 12))).catch(() => setCategories([]));
  }, []);

  const load = useCallback(async () => {
    setLoaded(false);
    try {
      const trimmed = term.trim();
      const page = trimmed.length >= 2
        ? await marketplaceApi.search(trimmed, { category: category === 'all' ? undefined : category })
        : await marketplaceApi.discover({ category: category === 'all' ? undefined : category });
      setItems(page.items);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load businesses.');
    } finally {
      setLoaded(true);
    }
  }, [category, term]);

  useEffect(() => {
    const handle = setTimeout(() => void load(), term ? 350 : 0);
    return () => clearTimeout(handle);
  }, [load, term]);

  const filterOptions = useMemo(
    () => ['all', ...categories.map((c) => c.slug)] as const,
    [categories],
  );
  const categoryLabel = (slug: string) => slug === 'all' ? 'All' : categories.find((c) => c.slug === slug)?.name ?? slug;

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow="EXPLORE" title="Find a business" subtitle="Browse trusted local businesses on Chakusa." />
      <SearchBar value={term} onChangeText={setTerm} placeholder="Search businesses or services" />
      {filterOptions.length > 1 ? (
        <View style={styles.filterWrap}>
          <FilterTabs options={filterOptions} value={category as (typeof filterOptions)[number]} onChange={(v) => setCategory(v)} />
        </View>
      ) : null}

      {!loaded ? <LoadingState label="Loading businesses…" />
        : error ? <ErrorState message={error} onRetry={() => void load()} />
        : !items.length ? (
          <EmptyState
            icon="search-outline"
            title="Nothing to show"
            message={term.trim() ? `No results for “${term.trim()}”${category !== 'all' ? ` in ${categoryLabel(category)}` : ''}.` : 'No businesses are listed for this filter yet.'}
          />
        ) : (
          <View style={styles.list}>
            <Text style={styles.count}>{items.length} result{items.length === 1 ? '' : 's'}</Text>
            {items.map((card) => (
              <BusinessCard key={card.slug} card={card} onPress={() => navigation.navigate('BusinessProfile', { slug: card.slug })} />
            ))}
          </View>
        )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  filterWrap: { marginHorizontal: -spacing.lg, paddingLeft: spacing.lg },
  list: { gap: spacing.sm },
  count: { ...typography.caption, color: colors.textSecondary },
});
