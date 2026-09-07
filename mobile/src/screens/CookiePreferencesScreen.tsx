import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ACCEPT_ALL_COOKIE_PREFERENCES,
  CookiePreferences,
  cookieConsentSource,
  DEFAULT_COOKIE_PREFERENCES,
  REJECT_OPTIONAL_COOKIE_PREFERENCES,
} from '../domain/cookiePreferences';
import { legalApi } from '../services/endpoints';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Icon, M3Card, M3Header, M3Screen } from '../experience/businessKit';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const options: { key: 'analytics' | 'marketing'; icon: string; title: string; detail: string }[] = [
  { key: 'analytics', icon: 'insights', title: 'Analytics', detail: 'Helps us understand how Chakusa is used so we can improve it.' },
  { key: 'marketing', icon: 'campaign', title: 'Marketing', detail: 'Lets us tailor promotional messages about Chakusa itself to you.' },
];

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function CookiePreferencesScreen() {
  const navigation = useNavigation<Nav>();
  const [preferences, setPreferences] = useState<CookiePreferences>(DEFAULT_COOKIE_PREFERENCES);
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const save = async (next: CookiePreferences) => {
    setPreferences(next);
    setSaveState('saving');
    try {
      await legalApi.businessAccept('COOKIE_POLICY', { source: cookieConsentSource(next), cookiePreferences: next });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  return (
    <M3Screen
      header={
        <M3Header
          businessName="Data and Legal"
          onBack={() => navigation.goBack()}
          onNotificationsPress={() => navigation.navigate('AttentionCenter')}
          hasNotifications={false}
        />
      }
    >
      <View style={styles.titleBlock}>
        <Text style={styles.eyebrow}>PRIVACY</Text>
        <Text style={styles.title}>Cookie preferences</Text>
        <Text style={styles.subtitle}>
          Choose what Chakusa is allowed to use beyond what is strictly necessary to run the app.
        </Text>
      </View>

      <View style={styles.notice}>
        <Icon name="info" size={18} color={m3.primary} />
        <Text style={styles.noticeText}>
          Strictly necessary functionality (staying signed in, security) is always on and is not a choice here. See the
          full Cookie Policy on chakusarecovery.com for detail on each category.
        </Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => void save(REJECT_OPTIONAL_COOKIE_PREFERENCES)}
          style={[styles.btn, styles.btnGhost]}
        >
          <Text style={styles.btnGhostText}>Reject optional</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => void save(ACCEPT_ALL_COOKIE_PREFERENCES)}
          style={[styles.btn, styles.btnPrimary]}
        >
          <Text style={styles.btnPrimaryText}>Accept all</Text>
        </Pressable>
      </View>

      <M3Card padded={false} style={styles.card}>
        {options.map((option, index) => (
          <View key={option.key} style={[styles.row, index < options.length - 1 && styles.border]}>
            <View style={styles.icon}>
              <Icon name={option.icon} size={19} color={m3.primary} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{option.title}</Text>
              <Text style={styles.rowDetail}>{option.detail}</Text>
            </View>
            <Switch
              accessibilityLabel={`${option.title} cookie preference`}
              value={preferences[option.key]}
              onValueChange={(value) => void save({ ...preferences, [option.key]: value })}
              trackColor={{ false: m3.surfaceContainerHigh, true: m3.secondary }}
              thumbColor={m3.surfaceContainerLowest}
            />
          </View>
        ))}
      </M3Card>

      {saveState === 'saving' ? <Text style={styles.status}>Saving…</Text> : null}
      {saveState === 'saved' ? <Text style={styles.status}>Saved.</Text> : null}
      {saveState === 'error' ? (
        <Text style={styles.statusError}>Could not save just now. Check your connection and try again.</Text>
      ) : null}
    </M3Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  titleBlock: { gap: 2 },
  eyebrow: { ...m3Type.labelSm, color: m3.secondary, letterSpacing: 0.6 },
  title: { ...m3Type.headlineMd, color: m3.onSurface, marginTop: 2 },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },

  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: m3Space.xs, padding: m3Space.md, borderRadius: m3Radius.md, backgroundColor: 'rgba(171,45,25,0.08)' },
  noticeText: { ...m3Type.bodySm, color: m3.onSurface, flex: 1 },

  actions: { flexDirection: 'row', gap: m3Space.xs },
  btn: { flex: 1, height: 44, borderRadius: m3Radius.md, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: m3.surfaceContainer },
  btnGhostText: { ...m3Type.labelMd, color: m3.onSurface },
  btnPrimary: { backgroundColor: m3.primary },
  btnPrimaryText: { ...m3Type.labelMd, color: m3.onPrimary },

  card: { paddingHorizontal: m3Space.md },
  row: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, paddingVertical: m3Space.sm },
  border: { borderBottomWidth: 1, borderBottomColor: m3.surfaceContainerHigh },
  icon: { width: 40, height: 40, borderRadius: m3Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: m3.surfaceContainerHigh },
  rowTitle: { ...m3Type.labelLg, color: m3.onSurface },
  rowDetail: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },

  status: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: m3Space.md, textAlign: 'center' },
  statusError: { ...m3Type.bodySm, color: m3.error, marginTop: m3Space.md, textAlign: 'center' },
});
