import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ReactNode, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import appConfig from '../../app.json';
import { formatAppVersion } from '../domain/trustSettings';
import { businessApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { useExperience } from '../experience/experienceContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { m3, m3Radius, m3Space, m3Shadow, m3Type } from '../experience/businessTheme';
import { Icon, M3Card, M3Header, M3Screen } from '../experience/businessKit';
import { RootStackParamList } from '../types';
import { titleCase } from '../utils/format';

type MenuTone = 'primary' | 'secondary' | 'tertiary' | 'neutral';
const expoConfig = appConfig.expo as typeof appConfig.expo & { ios?: { buildNumber?: string }; android?: { versionCode?: number } };
const version = formatAppVersion(expoConfig.version, expoConfig.ios?.buildNumber ?? expoConfig.android?.versionCode);

const TONE_BG: Record<MenuTone, string> = {
  primary: 'rgba(171,45,25,0.10)',
  secondary: 'rgba(0,106,97,0.12)',
  tertiary: m3.surfaceContainerHigh,
  neutral: m3.surfaceContainer,
};
const TONE_FG: Record<MenuTone, string> = {
  primary: m3.primary,
  secondary: m3.secondary,
  tertiary: m3.tertiary,
  neutral: m3.onSurfaceVariant,
};

export function AccountHubScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { business, user, role, logout, logoutAll } = useAuth();
  const { switching, switchExperience } = useExperience();
  const { plan, status, features } = usePlanExperience();
  const [sessionAction, setSessionAction] = useState<'logout' | 'all' | null>(null);
  const owner = role === 'OWNER';
  const canManageBusiness = role === 'OWNER' || role === 'ADMIN';
  const businessName = business?.name || 'Your business';
  const initials = businessName.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
  const planLabel = plan === 'BUSINESS' ? 'Business' : plan === 'PRO' ? (status === 'TRIALING' ? 'Pro trial' : 'Pro') : 'Free';

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
  const confirmLogout = () =>
    Alert.alert('Sign out of this device?', 'Your other signed-in devices will stay connected.', [
      { text: 'No, stay signed in', style: 'cancel' },
      { text: 'Yes, sign out', style: 'destructive', onPress: () => void runSessionAction('logout') },
    ]);
  const confirmLogoutAll = () =>
    Alert.alert('Sign out of all devices?', 'Every Chakusa session, including this device, will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out everywhere', style: 'destructive', onPress: () => void runSessionAction('all') },
    ]);

  const header = (
    <M3Header
      businessName="More"
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      onAvatarPress={() => navigation.navigate('AccountInformation')}
      hasNotifications={false}
    />
  );

  return (
    <M3Screen header={header}>
      <M3Card raised onPress={owner ? () => navigation.navigate('BusinessSettings') : undefined} style={styles.bizCard}>
        <View style={styles.bizAvatar}>
          <Text style={styles.bizInitials}>{initials || 'C'}</Text>
        </View>
        <View style={styles.flex}>
          <View style={styles.bizNameRow}>
            <Text numberOfLines={1} style={styles.bizName}>
              {businessName}
            </Text>
            {business?.publicSlug ? <Icon name="verified" size={15} color={m3.secondary} /> : null}
          </View>
          <Text numberOfLines={1} style={styles.bizMeta}>
            {business?.industry ? titleCase(business.industry) : 'Complete your business profile'}
          </Text>
          <View style={styles.planBadge}>
            <Icon name="verified_user" size={12} color={m3.secondary} />
            <Text style={styles.planText}>
              {planLabel} plan · {role ? titleCase(role) : 'Member'}
            </Text>
          </View>
        </View>
        {owner ? <Icon name="chevron_right" size={20} color={m3.outline} /> : null}
      </M3Card>

      <MenuSection title="Inbox & reputation">
        <MenuRow icon="forum" tone="primary" title="Messages" detail="Client conversations across SMS and WhatsApp" onPress={() => navigation.navigate('Messages')} />
        <MenuRow icon="star" tone="secondary" title="Reviews & ratings" detail="Requests, public reviews and private feedback" onPress={() => navigation.navigate('Main', { screen: 'Reviews' })} last />
      </MenuSection>

      <MenuSection title="Manage your business">
        {owner ? (
          <MenuRow icon="storefront" tone="primary" title="Business profile" detail="Details, hours and public page" onPress={() => navigation.navigate('BusinessSettings')} />
        ) : null}
        <MenuRow icon="group" tone="secondary" title="Team members" detail={features?.teamManagement ? 'Manage your team and their access' : 'View team access and plans'} onPress={() => navigation.navigate('Team')} />
        <MenuRow icon="notifications" tone="tertiary" title="Notifications" detail="Choose what Chakusa highlights for you" onPress={() => navigation.navigate('NotificationPreferences')} />
        <MenuRow icon="forum" tone="secondary" title="Message templates" detail="Customize customer messages and responses" onPress={() => navigation.navigate('Templates')} />
        {canManageBusiness ? (
          <MenuRow icon="sell" tone="tertiary" title="Services" detail="Duration, pricing and staff" onPress={() => navigation.navigate('ServiceCatalog')} />
        ) : null}
        <MenuRow icon="request_quote" tone="tertiary" title="Quotes & estimates" detail="Create, send and track priced quotes" onPress={() => navigation.navigate('Quotes')} />
        <MenuRow icon="receipt_long" tone="tertiary" title="Invoices" detail="Send invoices with a secure payment link" onPress={() => navigation.navigate('Invoices')} />
        <MenuRow icon="military_tech" tone="secondary" title="Loyalty & rewards" detail="Points, tiers, rewards and campaigns" onPress={() => navigation.navigate('LoyaltyManagement')} />
        <MenuRow icon="qr_code_scanner" tone="secondary" title="Redeem a reward" detail="Look up a customer's reward code" onPress={() => navigation.navigate('LoyaltyRedemptions')} />
        {canManageBusiness ? (
          <MenuRow icon="event_available" tone="secondary" title="Booking availability" detail="Hours, leave and blocked time" onPress={() => navigation.navigate('AvailabilitySettings')} />
        ) : null}
        {canManageBusiness ? (
          <MenuRow icon="cloud_upload" tone="tertiary" title="Import appointments" detail="Preview and import a calendar CSV" onPress={() => navigation.navigate('AppointmentsImport')} />
        ) : null}
        {owner ? (
          <MenuRow icon="calendar_today" tone="secondary" title="External calendar" detail="Subscribe from Apple, Google, or Outlook" onPress={() => navigation.navigate('ExternalCalendar')} />
        ) : null}
        <MenuRow icon="bolt" tone="tertiary" title="Automation" detail={features?.automation ? 'Manage active customer workflows' : 'Explore recovery workflows'} onPress={() => navigation.navigate('Automation')} last />
      </MenuSection>

      <MenuSection title="Growth">
        <MenuRow icon="insights" tone="tertiary" title="Business insights" detail="Growth trends, top services, top customers" onPress={() => navigation.navigate('Insights')} last />
      </MenuSection>

      <MenuSection title="Account">
        <MenuRow icon="credit_card" tone="primary" title="Subscription and billing" detail={`${planLabel} plan`} onPress={() => navigation.navigate('Pro')} />
        <MenuRow icon="verified_user" tone="tertiary" title="Security and sign-in" detail="Profile, password and connected accounts" onPress={() => navigation.navigate('AccountInformation')} />
        <MenuRow icon="sync_alt" tone="secondary" title={switching ? 'Switching…' : 'Switch to customer'} detail="Find and book services, view your rewards" disabled={switching} onPress={() => switchExperience('customer')} />
        <MenuRow icon="help" tone="secondary" title="Help and support" detail="Answers and contact options" onPress={() => navigation.navigate('Help')} />
        <MenuRow icon="info" tone="neutral" title="About Chakusa" detail={version} last />
      </MenuSection>

      <MenuSection title="Privacy and control">
        <MenuRow icon="shield" tone="tertiary" title="Data & legal" detail="Data ownership, export, terms, privacy and cookies" onPress={() => navigation.navigate('DataGovernance')} />
        <MenuRow icon="logout" tone="primary" title={sessionAction === 'all' ? 'Signing out everywhere…' : 'Sign out of all devices'} detail="Revoke every active Chakusa session" disabled={Boolean(sessionAction)} onPress={confirmLogoutAll} />
        <MenuRow icon="delete" tone="primary" title="Delete account" detail="Permanently remove your Chakusa account" destructive onPress={() => navigation.navigate('DeleteAccount')} last />
      </MenuSection>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Sign out of this device"
        disabled={Boolean(sessionAction)}
        onPress={confirmLogout}
        style={({ pressed }) => [styles.logout, pressed && styles.pressed, sessionAction && styles.disabled]}
      >
        <Icon name="logout" size={20} color={m3.error} />
        <Text style={styles.logoutText}>{sessionAction === 'logout' ? 'Signing out…' : 'Sign out'}</Text>
      </Pressable>
    </M3Screen>
  );
}

function MenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>
      <M3Card padded={false} style={styles.menuCard}>
        {children}
      </M3Card>
    </View>
  );
}

function MenuRow({
  icon,
  tone,
  title,
  detail,
  onPress,
  last,
  destructive = false,
  disabled = false,
}: {
  icon: string;
  tone: MenuTone;
  title: string;
  detail?: string;
  onPress?: () => void;
  last?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={detail ? `${title}. ${detail}` : title}
      accessibilityState={{ disabled }}
      disabled={!onPress || disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, !last && styles.menuBorder, pressed && styles.rowPressed, disabled && styles.disabled]}
    >
      <View style={[styles.menuIcon, { backgroundColor: destructive ? 'rgba(186,26,26,0.10)' : TONE_BG[tone] }]}>
        <Icon name={icon} size={19} color={destructive ? m3.error : TONE_FG[tone]} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.menuTitle, destructive && { color: m3.error }]}>{title}</Text>
        {detail ? (
          <Text numberOfLines={2} style={styles.menuDetail}>
            {detail}
          </Text>
        ) : null}
      </View>
      {onPress ? <Icon name="chevron_right" size={18} color={m3.outline} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.8 },
  rowPressed: { backgroundColor: m3.surfaceContainerLow },
  disabled: { opacity: 0.5 },

  bizCard: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  bizAvatar: { width: 56, height: 56, borderRadius: m3Radius.md, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  bizInitials: { ...m3Type.headlineSm, color: m3.onPrimary },
  bizNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bizName: { ...m3Type.headlineSm, fontSize: 18, color: m3.onSurface, flexShrink: 1 },
  bizMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  planBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, paddingHorizontal: 8, height: 22, borderRadius: m3Radius.full, backgroundColor: m3.secondaryContainer },
  planText: { ...m3Type.labelXs, color: m3.onSecondaryContainer, letterSpacing: 0 },

  section: { gap: m3Space.xs },
  sectionTitle: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.6, paddingHorizontal: 2 },
  menuCard: { paddingHorizontal: m3Space.md },
  menuRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: m3Space.sm, paddingVertical: 10 },
  menuBorder: { borderBottomWidth: 1, borderBottomColor: m3.surfaceContainerHigh },
  menuIcon: { width: 38, height: 38, borderRadius: m3Radius.sm, alignItems: 'center', justifyContent: 'center' },
  menuTitle: { ...m3Type.labelLg, color: m3.onSurface },
  menuDetail: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },

  logout: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: m3Space.xs, borderRadius: m3Radius.md, backgroundColor: m3.errorContainer },
  logoutText: { ...m3Type.labelLg, color: m3.onErrorContainer },
});
