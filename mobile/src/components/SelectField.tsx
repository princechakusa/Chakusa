import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleProp, StyleSheet, Text, TextInput, TextStyle, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { SelectOption } from '../domain/regionOptions';

export interface SelectFieldTheme {
  label: StyleProp<TextStyle>; trigger: StyleProp<ViewStyle>; triggerText: StyleProp<TextStyle>; placeholder: string; icon: string;
  accent: string; sheetBg: string; ink: string; inkSoft: string; line: string; selectedBg: string; font: string; fontMedium: string;
}

/**
 * A dropdown field: tap opens a searchable bottom sheet of options. A value
 * that is not in the list (e.g. saved before) is still shown and kept.
 */
export function SelectField({ label, value, options, onChange, placeholder = 'Select', title, theme, searchPlaceholder = 'Search' }: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  title?: string;
  theme: SelectFieldTheme;
  searchPlaceholder?: string;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.detail ?? ''} ${o.keywords ?? ''} ${o.value}`.toLowerCase().includes(q));
  }, [options, query]);

  const close = () => { setOpen(false); setQuery(''); };

  return (
    <View>
      <Text style={theme.label}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${selected?.label ?? (value || 'not set')}`} onPress={() => setOpen(true)} style={({ pressed }) => [theme.trigger, styles.trigger, pressed && styles.pressed]}>
        <Text numberOfLines={1} style={[theme.triggerText, styles.triggerText, !value && { color: theme.placeholder }]}>
          {selected ? selected.short ?? selected.label : value || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={theme.icon} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" statusBarTranslucent onRequestClose={close}>
        <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={close} />
        <View style={[styles.sheet, { backgroundColor: theme.sheetBg, paddingBottom: insets.bottom + 8 }]}>
          <View style={[styles.grabber, { backgroundColor: theme.line }]} />
          <Text style={[styles.title, { color: theme.ink, fontFamily: theme.fontMedium }]}>{title ?? label}</Text>
          <View style={[styles.search, { borderColor: theme.line }]}>
            <Ionicons name="search" size={17} color={theme.inkSoft} />
            <TextInput value={query} onChangeText={setQuery} placeholder={searchPlaceholder} placeholderTextColor={theme.inkSoft} autoCorrect={false} autoCapitalize="none" style={[styles.searchInput, { color: theme.ink, fontFamily: theme.font }]} />
            {query ? <Pressable hitSlop={8} onPress={() => setQuery('')}><Ionicons name="close-circle" size={17} color={theme.inkSoft} /></Pressable> : null}
          </View>
          <FlatList
            data={shown}
            keyExtractor={(o) => o.value}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={20}
            ListEmptyComponent={<Text style={[styles.empty, { color: theme.inkSoft, fontFamily: theme.font }]}>No matches</Text>}
            renderItem={({ item }) => {
              const on = item.value === value;
              return (
                <Pressable accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => { onChange(item.value); close(); }} style={({ pressed }) => [styles.option, on && { backgroundColor: theme.selectedBg }, pressed && styles.pressed]}>
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionLabel, { color: theme.ink, fontFamily: on ? theme.fontMedium : theme.font }]}>{item.label}</Text>
                    {item.detail ? <Text style={[styles.optionDetail, { color: theme.inkSoft, fontFamily: theme.font }]}>{item.detail}</Text> : null}
                  </View>
                  {on ? <Ionicons name="checkmark" size={20} color={theme.accent} /> : null}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  triggerText: { flex: 1 },
  pressed: { opacity: 0.7 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(14,17,22,0.45)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '78%', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 8, paddingHorizontal: 12 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 12 },
  title: { fontSize: 17, textAlign: 'center', marginBottom: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 14, paddingHorizontal: 12, minHeight: 46, marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 10 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12 },
  optionCopy: { flex: 1 },
  optionLabel: { fontSize: 15 },
  optionDetail: { fontSize: 12.5, marginTop: 1 },
  empty: { textAlign: 'center', paddingVertical: 24, fontSize: 14 },
});
