import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ReactNode, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Switch, Text, View } from 'react-native';
import appConfig from '../../app.json';
import { SUPPORT_EMAIL, SUPPORT_URL } from '../config';
import { subscriptionPeriodCopy, subscriptionStatusLabel } from '../domain/billing';
import { formatAppVersion, supportDestination } from '../domain/trustSettings';
import { copyrightLine } from '../domain/runtimeConfig';
import { openExternalDestination } from '../services/externalDestinations';
import { businessApi } from '../services/endpoints';
import { useRuntimeConfig } from '../services/runtimeConfig';
import { useAuth } from '../state/AuthContext';
import { useBilling } from '../state/BillingContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { AttentionPreferences, usePreferences } from '../state/PreferencesContext';
import { RootStackParamList } from '../types';
import { Icon, M3Header, M3Card, M3Screen } from '../experience/businessKit';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';

const expoConfig = appConfig.expo as typeof appConfig.expo & { ios?: { buildNumber?: string }; android?: { versionCode?: number } };
const version = formatAppVersion(expoConfig.version, expoConfig.ios?.buildNumber ?? expoConfig.android?.versionCode);

export function SettingsCompletionScreen() {
  // Read per render: the support link and company info are admin-controlled runtime config.
  const support = supportDestination(SUPPORT_URL, SUPPORT_EMAIL);
  const { company } = useRuntimeConfig();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { business, user, role, logout, logoutAll } = useAuth();
  const preferences = usePreferences();
  const { plan, status, features, usage, subscription } = usePlanExperience();
  const billing = useBilling();
  const [sessionAction, setSessionAction] = useState<'logout' | 'all' | null>(null);
  const [exporting, setExporting] = useState(false);
  const owner = role === 'OWNER';
  const planLabel =
    plan === 'BUSINESS'
      ? 'Chakusa Business'
      : plan !== 'PRO'
        ? 'Free plan'
        : status === 'TRIALING'
          ? 'Pro trial'
          : status === 'GRACE_PERIOD'
            ? 'Pro - payment issue'
            : status === 'EXPIRED' || status === 'CANCELED'
              ? 'Free limits apply'
              : 'Chakusa Pro';
  const setPreference = (key: keyof AttentionPreferences, value: boolean) =>
    preferences.setAttention({ ...preferences.attention, [key]: value });
  const runSessionAction = async (kind: 'logout' | 'all') => {
    if (sessionAction) return;
    setSessionAction(kind);
    try {
      if (kind === 'all') await logoutAll();
      else await logout();
    } catch {
      Alert.alert('Could not log out', 'Please check your connection and try again.');
    } finally {
      setSessionAction(null);
    }
  };
  const exportBusiness = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const data = await businessApi.exportData();
      await Share.share({ title: `${business?.name ?? 'Chakusa'} data export`, message: JSON.stringify(data, null, 2) });
    } catch (error) {
      Alert.alert('Could not export data', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setExporting(false);
    }
  };

  const header = (
    <M3Header
      businessName={user?.fullName ?? 'Your account'}
      location={`${business?.name ?? ''}${role ? ` · ${role[0]}${role.slice(1).toLowerCase()}` : ''}`}
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      hasNotifications={false}
    />
  );

  return (
    <M3Screen header={header}>
      {owner ? (
        <Group title="Business">
          <Row icon="storefront" label="Business details" value={business?.name ?? 'Not set'} onPress={() => navigation.navigate('BusinessSettings')} />
          <Row icon="business_center" label="Industry" value={business?.industry ?? 'Not set'} onPress={() => navigation.navigate('BusinessSettings')} />
          <Row icon="flag" label="Business phone" value={business?.phone ?? 'Not set'} onPress={() => navigation.navigate('BusinessSettings')} />
          <Row icon="content_cut" label="Services" value={`${business?.defaultServices?.length ?? 0} configured`} onPress={() => navigation.navigate('BusinessSettings')} last />
        </Group>
      ) : null}

      <Group title="Team">
        <Row icon="group" label="Team" value={features?.teamManagement ? 'Chakusa Business' : 'View Business'} onPress={() => navigation.navigate('Team')} last />
      </Group>

      <Group title="Preferences">
        <Text style={styles.helper}>These controls change what appears in your in-app attention view on this device.</Text>
        {(
          [
            ['missedCalls', 'Missed calls'],
            ['reviews', 'Review requests'],
            ['comebacks', 'Comeback reminders'],
            ['businessActivity', 'Business activity'],
          ] as const
        ).map(([key, label], index) => (
          <ToggleRow key={key} label={label} value={preferences.attention[key]} onChange={(value) => setPreference(key, value)} last={index === 3} />
        ))}
      </Group>

      <Group title="Subscription & plan">
        <Row icon="credit_card" label="Current plan" value={planLabel} onPress={owner ? () => navigation.navigate('Pro') : undefined} />
        {subscription ? (
          <Row icon="calendar_today" label={subscriptionStatusLabel(subscription)} value={subscriptionPeriodCopy(subscription) ?? undefined} />
        ) : null}
        <Row icon="bolt" label="Automation" value={features?.automation ? 'Available' : 'Paid feature'} onPress={() => navigation.navigate('Automation')} />
        <Row icon="analytics" label="Usage" value={usage ? `${usage.leads.current}/${usage.leads.limit ?? '∞'} leads` : 'View'} />
        {owner && subscription?.provider ? <Row icon="settings" label="Manage Subscription" onPress={() => void billing.manage()} /> : null}
        {owner ? <Row icon="auto_awesome" label="Plans" value="Free · Pro · Business" onPress={() => navigation.navigate('Pro')} last /> : null}
      </Group>

      <Group title="Account & security">
        <Row icon="account_circle" label="Account information" value={user?.email} onPress={() => navigation.navigate('AccountInformation')} />
        {owner ? (
          <Row icon="download" label={exporting ? 'Preparing export…' : 'Export business data'} disabled={exporting} onPress={() => void exportBusiness()} />
        ) : null}
        <Row
          icon="logout"
          label={sessionAction === 'logout' ? 'Logging out…' : 'Log out of this device'}
          disabled={Boolean(sessionAction)}
          onPress={() =>
            Alert.alert('Log out of this device?', 'Your other signed-in devices will stay connected.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Log out', style: 'destructive', onPress: () => void runSessionAction('logout') },
            ])
          }
        />
        <Row
          icon="lock"
          label={sessionAction === 'all' ? 'Logging out…' : 'Log out of all devices'}
          disabled={Boolean(sessionAction)}
          onPress={() =>
            Alert.alert('Log out of all devices?', 'Every Chakusa session, including this device, will need to sign in again.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Log out everywhere', style: 'destructive', onPress: () => void runSessionAction('all') },
            ])
          }
          last
        />
      </Group>

      <Group title="Help">
        <Row icon="help" label="Help / FAQ" onPress={() => navigation.navigate('Help')} />
        <Row icon="forum" label="Contact Support" value={support ? 'Open' : 'Not configured'} onPress={() => void openExternalDestination(support, 'Contact Support')} last />
      </Group>

      <Group title="Legal">
        <Row icon="verified_user" label="Privacy Policy" onPress={() => navigation.navigate('LegalDocument', { page: 'privacy' })} />
        <Row icon="description" label="Terms of Use" onPress={() => navigation.navigate('LegalDocument', { page: 'terms' })} last />
      </Group>

      <Group title="Danger zone" destructive>
        <Row icon="delete" label="Delete Account" destructive onPress={() => navigation.navigate('DeleteAccount')} last />
      </Group>

      <Group title="About">
        <Row icon="info" label="Chakusa" value={version} />
        <Row icon="copyright" label={copyrightLine(company)} last />
      </Group>
    </M3Screen>
  );
}

function Group({ title, children, destructive = false }: { title: string; children: ReactNode; destructive?: boolean }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, destructive && styles.destructiveText]}>{title.toUpperCase()}</Text>
      <M3Card padded={false} style={[styles.group, destructive && styles.dangerGroup]}>
        {children}
      </M3Card>
    </View>
  );
}

function Row({
  icon,
  label,
  value,
  onPress,
  last,
  destructive = false,
  disabled = false,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{ disabled }}
      accessibilityLabel={value ? `${label}, ${value}` : label}
      disabled={!onPress || disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.rowBorder, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={[styles.rowIcon, destructive && styles.rowIconDestructive]}>
        <Icon name={icon} size={18} color={destructive ? m3.error : m3.onSurfaceVariant} />
      </View>
      <Text style={[styles.label, destructive && styles.destructiveText]}>{label}</Text>
      {value ? (
        <Text numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}
      {onPress ? <Icon name="chevron_right" size={18} color={m3.outline} /> : null}
    </Pressable>
  );
}

function ToggleRow({ label, value, onChange, last }: { label: string; value: boolean; onChange: (value: boolean) => void; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <View style={styles.rowIcon}>
        <Icon name="notifications" size={18} color={m3.onSurfaceVariant} />
      </View>
      <Text style={styles.label}>{label}</Text>
      <Switch
        accessibilityLabel={`${label} in-app attention preference`}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: m3.outlineVariant, true: m3.secondary }}
        thumbColor={m3.surfaceContainerLowest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: m3Space.xs },
  sectionTitle: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.6, paddingHorizontal: 2 },
  destructiveText: { color: m3.error },
  group: { paddingHorizontal: m3Space.md },
  dangerGroup: { borderWidth: 1, borderColor: m3.errorContainer },

  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, paddingVertical: 8 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: m3.surfaceContainerHigh },
  rowIcon: { width: 34, height: 34, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  rowIconDestructive: { backgroundColor: m3.errorContainer },
  label: { ...m3Type.bodyMd, color: m3.onSurface, flex: 1 },
  value: { ...m3Type.bodySm, color: m3.onSurfaceVariant, maxWidth: '42%' },
  helper: { ...m3Type.bodySm, color: m3.onSurfaceVariant, paddingVertical: m3Space.xs },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
});
