import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { AttentionPreferences, usePreferences } from '../state/PreferencesContext';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Icon, IconName, M3Card, M3Header, M3Screen } from '../experience/businessKit';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

const options: { key: keyof AttentionPreferences; icon: IconName; title: string; detail: string }[] = [
  { key: 'missedCalls', icon: 'call', title: 'Missed calls', detail: 'Show supported missed-call follow-up in your attention view.' },
  { key: 'reviews', icon: 'star', title: 'Review requests', detail: 'Show customers who are ready for a review request.' },
  { key: 'comebacks', icon: 'restart_alt', title: 'Comeback reminders', detail: 'Show customers who may be ready to return.' },
  { key: 'businessActivity', icon: 'monitor_heart', title: 'Business activity', detail: 'Show important customer and business activity.' },
];

export function NotificationPreferencesScreen() {
  const navigation = useNavigation<Nav>();
  const preferences = usePreferences();
  const update = (key: keyof AttentionPreferences, value: boolean) => preferences.setAttention({ ...preferences.attention, [key]: value });

  return (
    <M3Screen
      header={
        <M3Header
          businessName="Notifications"
          onBack={() => navigation.goBack()}
          onNotificationsPress={() => navigation.navigate('AttentionCenter')}
          hasNotifications={false}
        />
      }
    >
      <View style={styles.titleBlock}>
        <Text style={styles.eyebrow}>PREFERENCES</Text>
        <Text style={styles.title}>Attention view</Text>
        <Text style={styles.subtitle}>Choose what Chakusa highlights in your in-app attention view.</Text>
      </View>

      <View style={styles.notice}>
        <Icon name="info" size={18} color={m3.primary} />
        <Text style={styles.noticeText}>
          These preferences affect what Chakusa shows inside the app on this device. Phone notification permission is
          controlled by your device settings.
        </Text>
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
              accessibilityLabel={`${option.title} in-app attention preference`}
              value={preferences.attention[option.key]}
              onValueChange={(value) => update(option.key, value)}
              trackColor={{ false: m3.surfaceContainerHigh, true: m3.secondary }}
              thumbColor={m3.surfaceContainerLowest}
            />
          </View>
        ))}
      </M3Card>
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

  card: { paddingHorizontal: m3Space.md },
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, paddingVertical: m3Space.sm },
  border: { borderBottomWidth: 1, borderBottomColor: m3.surfaceContainerHigh },
  icon: { width: 40, height: 40, borderRadius: m3Radius.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: m3.surfaceContainerHigh },
  rowTitle: { ...m3Type.labelLg, color: m3.onSurface },
  rowDetail: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
});
