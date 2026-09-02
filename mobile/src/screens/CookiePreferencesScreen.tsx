import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { AppHeader, PrimaryButton, Screen, SecondaryButton } from '../components/ui';
import { CookiePreferences, DEFAULT_COOKIE_PREFERENCES, ACCEPT_ALL_COOKIE_PREFERENCES, REJECT_OPTIONAL_COOKIE_PREFERENCES, cookieConsentSource } from '../domain/cookiePreferences';
import { legalApi } from '../services/endpoints';
import { colors, radius, spacing, typography } from '../theme';

// PROGRAM 2 LOOP 4: Cookie Policy consent isn't a mandatory onboarding
// gate like Terms/Privacy/AI Disclosure — it's absent from
// TYPES_BY_SCOPE.BUSINESS in legalDocuments.service.ts on purpose, so this
// screen is reachable any time from Account > Privacy and control, not
// forced on first launch.
const options: { key: 'analytics' | 'marketing'; icon: keyof typeof Ionicons.glyphMap; title: string; detail: string }[] = [
  { key: 'analytics', icon: 'stats-chart-outline', title: 'Analytics', detail: 'Helps us understand how Chakusa is used so we can improve it.' },
  { key: 'marketing', icon: 'megaphone-outline', title: 'Marketing', detail: 'Lets us tailor promotional messages about Chakusa itself to you.' },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function CookiePreferencesScreen() {
  const [preferences, setPreferences] = useState<CookiePreferences>(DEFAULT_COOKIE_PREFERENCES);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const save = async (next: CookiePreferences) => {
    setPreferences(next);
    setSaveState('saving');
    try {
      await legalApi.businessAccept('COOKIE_POLICY', { source: cookieConsentSource(next), cookiePreferences: next });
      setSaveState('saved');
    } catch { setSaveState('error'); }
  };

  return <Screen>
    <AppHeader eyebrow="PRIVACY" title="Cookie preferences" subtitle="Choose what Chakusa is allowed to use beyond what's strictly necessary to run the app." />
    <View style={styles.notice}><Ionicons name="information-circle-outline" size={21} color={colors.primary} /><Text style={styles.noticeText}>Strictly-necessary functionality (staying signed in, security) is always on and isn't a choice here. See the full Cookie Policy on chakusarecovery.com for detail on each category.</Text></View>
    <View style={styles.actions}>
      <SecondaryButton fullWidth label="Reject optional" onPress={() => void save(REJECT_OPTIONAL_COOKIE_PREFERENCES)} />
      <PrimaryButton fullWidth label="Accept all" onPress={() => void save(ACCEPT_ALL_COOKIE_PREFERENCES)} />
    </View>
    <View style={styles.card}>{options.map((option, index) => <View key={option.key} style={[styles.row, index < options.length - 1 && styles.border]}>
      <View style={styles.icon}><Ionicons name={option.icon} size={20} color={colors.primary} /></View>
      <View style={styles.copy}><Text style={styles.title}>{option.title}</Text><Text style={styles.detail}>{option.detail}</Text></View>
      <Switch accessibilityLabel={`${option.title} cookie preference`} value={preferences[option.key]} onValueChange={value => void save({ ...preferences, [option.key]: value })} trackColor={{ false: colors.border, true: colors.success }} thumbColor={colors.surface} />
    </View>)}</View>
    {saveState === 'saving' ? <Text style={styles.status}>Saving…</Text> : null}
    {saveState === 'saved' ? <Text style={styles.status}>Saved.</Text> : null}
    {saveState === 'error' ? <Text style={styles.statusError}>Couldn't save just now. Check your connection and try again.</Text> : null}
  </Screen>;
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.primarySoft, marginBottom: spacing.md },
  noticeText: { ...typography.caption, color: colors.text, flex: 1 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.md },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  border: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primarySoft },
  copy: { flex: 1, minWidth: 0 },
  title: { ...typography.bodyStrong, color: colors.text },
  detail: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
  status: { ...typography.caption, color: colors.textSecondary, marginTop: spacing.md, textAlign: 'center' },
  statusError: { ...typography.caption, color: colors.negative, marginTop: spacing.md, textAlign: 'center' },
});
