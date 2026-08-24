import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { AppHeader, Screen } from '../components/ui';
import { AttentionPreferences, usePreferences } from '../state/PreferencesContext';
import { colors, radius, spacing, typography } from '../theme';

const options: { key: keyof AttentionPreferences; icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }[] = [
  { key: 'missedCalls', icon: 'call-outline', title: 'Missed calls', detail: 'Show supported missed-call follow-up in your attention view.' },
  { key: 'reviews', icon: 'star-outline', title: 'Review requests', detail: 'Show customers who are ready for a review request.' },
  { key: 'comebacks', icon: 'refresh-outline', title: 'Comeback reminders', detail: 'Show customers who may be ready to return.' },
  { key: 'businessActivity', icon: 'pulse-outline', title: 'Business activity', detail: 'Show important customer and business activity.' },
];

export function NotificationPreferencesScreen() {
  const preferences = usePreferences();
  const update = (key: keyof AttentionPreferences, value: boolean) => preferences.setAttention({ ...preferences.attention, [key]: value });

  return <Screen>
    <AppHeader eyebrow="PREFERENCES" title="Notifications" subtitle="Choose what Chakusa highlights in your in-app attention view." />
    <View style={styles.notice}><Ionicons name="information-circle-outline" size={21} color={colors.primary} /><Text style={styles.noticeText}>These preferences affect what Chakusa shows inside the app on this device. Phone notification permission is controlled by your device settings.</Text></View>
    <View style={styles.card}>{options.map((option, index) => <View key={option.key} style={[styles.row, index < options.length - 1 && styles.border]}>
      <View style={styles.icon}><Ionicons name={option.icon} size={20} color={colors.primary} /></View>
      <View style={styles.copy}><Text style={styles.title}>{option.title}</Text><Text style={styles.detail}>{option.detail}</Text></View>
      <Switch accessibilityLabel={`${option.title} in-app attention preference`} value={preferences.attention[option.key]} onValueChange={value => update(option.key, value)} trackColor={{ false: colors.border, true: colors.success }} thumbColor={colors.surface} />
    </View>)}</View>
  </Screen>;
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primarySoft },
  noticeText: { ...typography.caption, color: colors.text, flex: 1 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.md },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  border: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  copy: { flex: 1, minWidth: 0 },
  title: { ...typography.bodyStrong, color: colors.text },
  detail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
});
