import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '../theme';
import { KeyboardModal } from './KeyboardModal';
import { countryFlag, countryForPhone, normalizePhone, searchCountries, type Country } from '../domain/countries';

const digits = (value: string) => value.replace(/\D/g, '');
export { normalizePhone };

export function CountryPhoneInput({ value, onChange, onCountryChange, label = 'Phone', defaultCountryCode = 'ZW' }: { value: string; onChange: (value: string) => void; onCountryChange?: (code: string) => void; label?: string; defaultCountryCode?: string }) {
  const initial = useMemo(() => countryForPhone(value, defaultCountryCode), [defaultCountryCode]);
  const [country, setCountry] = useState(initial);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => { if (value.startsWith('+') && !value.startsWith(country.dial)) setCountry(countryForPhone(value, defaultCountryCode)); }, [country.dial, defaultCountryCode, value]);
  const local = value.startsWith(country.dial) ? value.slice(country.dial.length) : digits(value);
  const visible = useMemo(() => searchCountries(search), [search]);
  const choose = (next: Country) => { setCountry(next); onCountryChange?.(next.code); onChange(normalizePhone(next.dial, local)); setOpen(false); setSearch(''); };

  return <View><Text style={styles.label}>{label}</Text><View style={styles.field}><Pressable accessibilityRole="button" accessibilityLabel={`Country, ${country.name} ${country.dial}`} onPress={() => setOpen(true)} style={styles.countryButton}><Text style={styles.flag}>{countryFlag(country.code)}</Text><Text style={styles.dial}>{country.dial}</Text><Ionicons name="chevron-down" size={16} color={colors.textSecondary} /></Pressable><View style={styles.divider} /><TextInput accessibilityLabel={`${label} number`} keyboardType="phone-pad" value={local} onChangeText={text => onChange(normalizePhone(country.dial, text))} placeholder="Phone number" placeholderTextColor={colors.textSecondary} style={styles.input} /></View>
    <KeyboardModal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}><SafeAreaView style={styles.modal}><View style={styles.modalHeader}><Text style={styles.title}>Choose country</Text><Pressable accessibilityRole="button" accessibilityLabel="Close country list" onPress={() => setOpen(false)} style={styles.close}><Ionicons name="close" size={24} color={colors.text} /></Pressable></View><View style={styles.search}><Ionicons name="search" size={19} color={colors.textSecondary} /><TextInput autoFocus value={search} onChangeText={setSearch} placeholder="Search country or dial code" placeholderTextColor={colors.textSecondary} style={styles.searchInput} /></View><FlatList style={styles.list} data={visible} keyExtractor={item => item.code} keyboardShouldPersistTaps="handled" initialNumToRender={20} windowSize={9} ListEmptyComponent={<Text style={styles.countryDial}>No country matches “{search}”.</Text>} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.name} ${item.dial}`} onPress={() => choose(item)} style={styles.countryRow}><Text style={styles.rowFlag}>{countryFlag(item.code)}</Text><Text style={styles.countryName}>{item.name}</Text><Text style={styles.countryDial}>{item.dial}</Text>{country.code === item.code ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}</Pressable>} /></SafeAreaView></KeyboardModal>
  </View>;
}

const styles = StyleSheet.create({ label: { ...typography.caption, color: colors.text, marginBottom: spacing.xs }, field: { minHeight: 50, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }, countryButton: { minHeight: 48, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, flag: { fontSize: 22 }, dial: { ...typography.bodyStrong, color: colors.text }, divider: { width: 1, height: 28, backgroundColor: colors.border }, input: { flex: 1, minHeight: 48, paddingHorizontal: spacing.sm, ...typography.body, color: colors.text }, modal: { flex: 1, backgroundColor: colors.background, padding: spacing.lg }, modalHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { ...typography.heading, color: colors.text }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, search: { height: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginBottom: spacing.md }, searchInput: { flex: 1, ...typography.body, color: colors.text }, list: { flex: 1 }, countryRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider }, rowFlag: { fontSize: 24 }, countryName: { ...typography.body, color: colors.text, flex: 1 }, countryDial: { ...typography.body, color: colors.textSecondary } });
