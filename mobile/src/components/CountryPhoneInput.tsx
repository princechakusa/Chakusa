import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, typography } from '../theme';

interface Country { code: string; name: string; dial: string; }
const countries: Country[] = [
  { code: 'ZW', name: 'Zimbabwe', dial: '+263' }, { code: 'ZA', name: 'South Africa', dial: '+27' },
  { code: 'BW', name: 'Botswana', dial: '+267' }, { code: 'ZM', name: 'Zambia', dial: '+260' },
  { code: 'KE', name: 'Kenya', dial: '+254' }, { code: 'NG', name: 'Nigeria', dial: '+234' },
  { code: 'GH', name: 'Ghana', dial: '+233' }, { code: 'TZ', name: 'Tanzania', dial: '+255' },
  { code: 'UG', name: 'Uganda', dial: '+256' }, { code: 'AE', name: 'United Arab Emirates', dial: '+971' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966' }, { code: 'IN', name: 'India', dial: '+91' },
  { code: 'GB', name: 'United Kingdom', dial: '+44' }, { code: 'US', name: 'United States', dial: '+1' },
  { code: 'CA', name: 'Canada', dial: '+1' }, { code: 'AU', name: 'Australia', dial: '+61' },
  { code: 'NZ', name: 'New Zealand', dial: '+64' }, { code: 'DE', name: 'Germany', dial: '+49' },
  { code: 'FR', name: 'France', dial: '+33' }, { code: 'ES', name: 'Spain', dial: '+34' },
  { code: 'IT', name: 'Italy', dial: '+39' }, { code: 'BR', name: 'Brazil', dial: '+55' },
  { code: 'MX', name: 'Mexico', dial: '+52' }, { code: 'SG', name: 'Singapore', dial: '+65' },
  { code: 'MY', name: 'Malaysia', dial: '+60' }, { code: 'PH', name: 'Philippines', dial: '+63' },
  { code: 'JP', name: 'Japan', dial: '+81' }, { code: 'CN', name: 'China', dial: '+86' },
];
const digits = (value: string) => value.replace(/\D/g, '');
const countryFlag = (code: string) => String.fromCodePoint(...code.toUpperCase().split('').map(letter => 127397 + letter.charCodeAt(0)));
const countryFor = (value: string, fallbackCode: string) => countries.slice().sort((a, b) => b.dial.length - a.dial.length).find(item => value.startsWith(item.dial)) ?? countries.find(item => item.code === fallbackCode) ?? countries[0];
export const normalizePhone = (dial: string, local: string) => `${dial}${digits(local).replace(/^0+/, '')}`;

export function CountryPhoneInput({ value, onChange, onCountryChange, label = 'Phone', defaultCountryCode = 'ZW' }: { value: string; onChange: (value: string) => void; onCountryChange?: (code: string) => void; label?: string; defaultCountryCode?: string }) {
  const initial = useMemo(() => countryFor(value, defaultCountryCode), [defaultCountryCode]);
  const [country, setCountry] = useState(initial);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  useEffect(() => { if (value.startsWith('+') && !value.startsWith(country.dial)) setCountry(countryFor(value, defaultCountryCode)); }, [country.dial, defaultCountryCode, value]);
  const local = value.startsWith(country.dial) ? value.slice(country.dial.length) : digits(value);
  const visible = countries.filter(item => `${item.name} ${item.dial} ${item.code}`.toLowerCase().includes(search.toLowerCase()));
  const choose = (next: Country) => { setCountry(next); onCountryChange?.(next.code); onChange(normalizePhone(next.dial, local)); setOpen(false); setSearch(''); };

  return <View><Text style={styles.label}>{label}</Text><View style={styles.field}><Pressable accessibilityRole="button" accessibilityLabel={`Country, ${country.name} ${country.dial}`} onPress={() => setOpen(true)} style={styles.countryButton}><Text style={styles.flag}>{countryFlag(country.code)}</Text><Text style={styles.dial}>{country.dial}</Text><Ionicons name="chevron-down" size={16} color={colors.textSecondary} /></Pressable><View style={styles.divider} /><TextInput accessibilityLabel={`${label} number`} keyboardType="phone-pad" value={local} onChangeText={text => onChange(normalizePhone(country.dial, text))} placeholder="Phone number" placeholderTextColor={colors.textSecondary} style={styles.input} /></View>
    <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}><SafeAreaView style={styles.modal}><View style={styles.modalHeader}><Text style={styles.title}>Choose country</Text><Pressable accessibilityRole="button" accessibilityLabel="Close country list" onPress={() => setOpen(false)} style={styles.close}><Ionicons name="close" size={24} color={colors.text} /></Pressable></View><View style={styles.search}><Ionicons name="search" size={19} color={colors.textSecondary} /><TextInput autoFocus value={search} onChangeText={setSearch} placeholder="Search country or dial code" placeholderTextColor={colors.textSecondary} style={styles.searchInput} /></View><ScrollView style={styles.list} keyboardShouldPersistTaps="handled">{visible.map(item => <Pressable key={item.code} onPress={() => choose(item)} style={styles.countryRow}><Text style={styles.rowFlag}>{countryFlag(item.code)}</Text><Text style={styles.countryName}>{item.name}</Text><Text style={styles.countryDial}>{item.dial}</Text>{country.code === item.code ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}</Pressable>)}</ScrollView></SafeAreaView></Modal>
  </View>;
}

const styles = StyleSheet.create({ label: { ...typography.caption, color: colors.text, marginBottom: spacing.xs }, field: { minHeight: 50, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md }, countryButton: { minHeight: 48, paddingHorizontal: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.xs }, flag: { fontSize: 22 }, dial: { ...typography.bodyStrong, color: colors.text }, divider: { width: 1, height: 28, backgroundColor: colors.border }, input: { flex: 1, minHeight: 48, paddingHorizontal: spacing.sm, ...typography.body, color: colors.text }, modal: { flex: 1, backgroundColor: colors.background, padding: spacing.lg }, modalHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, title: { ...typography.heading, color: colors.text }, close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, search: { height: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, marginBottom: spacing.md }, searchInput: { flex: 1, ...typography.body, color: colors.text }, list: { flex: 1 }, countryRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider }, rowFlag: { fontSize: 24 }, countryName: { ...typography.body, color: colors.text, flex: 1 }, countryDial: { ...typography.body, color: colors.textSecondary } });
