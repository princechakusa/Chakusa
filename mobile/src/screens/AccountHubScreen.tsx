import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import appConfig from '../../app.json';
import { AppHeader, Screen } from '../components/ui';
import { formatAppVersion } from '../domain/trustSettings';
import { businessApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { useExperience } from '../experience/experienceContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { colors, radius, shadows, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';
import { titleCase } from '../utils/format';

type IconName = keyof typeof Ionicons.glyphMap;
type MenuTone = 'red' | 'purple' | 'amber' | 'green' | 'blue' | 'slate';
const expoConfig = appConfig.expo as typeof appConfig.expo & { ios?: { buildNumber?: string }; android?: { versionCode?: number } };
const version = formatAppVersion(expoConfig.version, expoConfig.ios?.buildNumber ?? expoConfig.android?.versionCode);

export function AccountHubScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { business, user, role, logout, logoutAll } = useAuth();
  const { switchExperience } = useExperience();
  const { plan, status, features } = usePlanExperience();
  const [sessionAction, setSessionAction] = useState<'logout'|'all'|null>(null);
  const [exporting, setExporting] = useState(false);
  const owner = role === 'OWNER';
  const canManageBusiness = role === 'OWNER' || role === 'ADMIN';
  const businessName = business?.name || 'Your business';
  const firstName = user?.fullName?.trim().split(/\s+/)[0] || 'there';
  const initials = businessName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase();
  const planLabel = plan === 'BUSINESS' ? 'Business' : plan === 'PRO' ? status === 'TRIALING' ? 'Pro trial' : 'Pro' : 'Free';

  const runSessionAction = async (kind: 'logout'|'all') => {
    if (sessionAction) return;
    setSessionAction(kind);
    try { if (kind === 'all') await logoutAll(); else await logout(); }
    catch { Alert.alert('Could not log out', 'Please check your connection and try again.'); }
    finally { setSessionAction(null); }
  };
  const confirmLogout = () => Alert.alert('Sign out of this device?', 'Your other signed-in devices will stay connected.', [
    { text: 'No, stay signed in', style: 'cancel' },
    { text: 'Yes, sign out', style: 'destructive', onPress: () => void runSessionAction('logout') },
  ]);
  const confirmLogoutAll = () => Alert.alert('Sign out of all devices?', 'Every Chakusa session, including this device, will need to sign in again.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Sign out everywhere', style: 'destructive', onPress: () => void runSessionAction('all') },
  ]);
  const exportBusiness = async () => {
    if (exporting) return;
    setExporting(true);
    try { const data = await businessApi.exportData(); await Share.share({ title: `${businessName} data export`, message: JSON.stringify(data, null, 2) }); }
    catch (error) { Alert.alert('Could not export data', error instanceof Error ? error.message : 'Please try again.'); }
    finally { setExporting(false); }
  };

  return <Screen style={styles.screen}>
    <AppHeader title="Account" subtitle="Manage your business and app settings." eyebrow={`HELLO, ${firstName.toUpperCase()}`} right={<Pressable accessibilityRole="button" accessibilityLabel="Open attention center" onPress={() => navigation.navigate('AttentionCenter')} style={({ pressed }) => [styles.headerButton, pressed && styles.pressed]}><Ionicons name="notifications-outline" size={23} color={colors.text} /></Pressable>} />

    <Pressable accessibilityRole={owner ? 'button' : undefined} accessibilityLabel={`${businessName}, ${planLabel} plan`} disabled={!owner} onPress={() => navigation.navigate('BusinessSettings')} style={({ pressed }) => [styles.businessCard, pressed && styles.pressed]}>
      <View style={styles.businessAvatar}><Text style={styles.businessInitials}>{initials || 'C'}</Text></View>
      <View style={styles.businessCopy}><Text numberOfLines={1} style={styles.businessName}>{businessName}</Text><Text numberOfLines={1} style={styles.businessMeta}>{business?.industry ? titleCase(business.industry) : 'Complete your business profile'}</Text><View style={styles.planBadge}><Ionicons name="shield-checkmark-outline" size={13} color={colors.success} /><Text style={styles.planText}>{planLabel} plan · {role ? titleCase(role) : 'Member'}</Text></View></View>
      {owner ? <Ionicons name="chevron-forward" size={21} color={colors.tabInactive} /> : null}
    </Pressable>

    <MenuSection title="MANAGE YOUR BUSINESS">
      {owner ? <MenuRow icon="storefront-outline" tone="red" title="Business profile" detail="Business details, hours and public page" onPress={() => navigation.navigate('BusinessSettings')} /> : null}
      <MenuRow icon="people-outline" tone="purple" title="Team members" detail={features?.teamManagement ? 'Manage your team and their access' : 'View team access and plans'} onPress={() => navigation.navigate('Team')} />
      <MenuRow icon="notifications-outline" tone="amber" title="Notifications" detail="Choose what Chakusa highlights for you" onPress={() => navigation.navigate('NotificationPreferences')} />
      <MenuRow icon="chatbubble-ellipses-outline" tone="green" title="Message templates" detail="Customize customer messages and responses" onPress={() => navigation.navigate('Templates')} />
      {canManageBusiness ? <MenuRow icon="pricetag-outline" tone="blue" title="Services" detail={`${business?.defaultServices?.length ?? 0} configured · duration, pricing and staff`} onPress={() => navigation.navigate('ServiceCatalog')} /> : null}
      <MenuRow icon="ribbon-outline" tone="purple" title="Loyalty & rewards" detail="Points, tiers, rewards, memberships and campaigns" onPress={() => navigation.navigate('LoyaltyManagement')} />
      <MenuRow icon="qr-code-outline" tone="green" title="Redeem a reward" detail="Look up a customer's reward code" onPress={() => navigation.navigate('LoyaltyRedemptions')} />
      {canManageBusiness ? <MenuRow icon="calendar-outline" tone="green" title="Booking availability" detail="Hours, leave and blocked time" onPress={() => navigation.navigate('AvailabilitySettings')} /> : null}
      {canManageBusiness ? <MenuRow icon="cloud-upload-outline" tone="blue" title="Import appointments" detail="Preview and import an existing calendar CSV" onPress={() => navigation.navigate('AppointmentsImport')} /> : null}
      {owner ? <MenuRow icon="calendar-outline" tone="green" title="External calendar" detail="Subscribe from Apple, Google, or Outlook" onPress={() => navigation.navigate('ExternalCalendar')} /> : null}
      <MenuRow icon="flash-outline" tone="amber" title="Automation" detail={features?.automation ? 'Manage active customer workflows' : 'Explore recovery workflows'} onPress={() => navigation.navigate('Automation')} last />
    </MenuSection>

    <MenuSection title="ACCOUNT">
      <MenuRow icon="card-outline" tone="red" title="Subscription and billing" detail={`${planLabel} plan`} onPress={() => navigation.navigate('Pro')} />
      <MenuRow icon="shield-checkmark-outline" tone="blue" title="Security and sign-in" detail="Profile, password and connected accounts" onPress={() => navigation.navigate('AccountInformation')} />
      <MenuRow icon="swap-horizontal-outline" tone="green" title="Switch to customer" detail="Find and book services, and view your rewards" onPress={() => switchExperience('customer')} />
      <MenuRow icon="help-circle-outline" tone="purple" title="Help and support" detail="Answers and contact options" onPress={() => navigation.navigate('Help')} />
      <MenuRow icon="information-circle-outline" tone="slate" title="About Chakusa" detail={version} last />
    </MenuSection>

    <MenuSection title="PRIVACY AND CONTROL">
      {owner ? <MenuRow icon="download-outline" tone="blue" title={exporting ? 'Preparing your export…' : 'Export business data'} detail="Download a copy of your Chakusa data" disabled={exporting} onPress={() => void exportBusiness()} /> : null}
      <MenuRow icon="document-text-outline" tone="slate" title="Terms of use" detail="Read inside Chakusa" onPress={() => navigation.navigate('LegalDocument', { page: 'terms' })} />
      <MenuRow icon="lock-closed-outline" tone="slate" title="Privacy policy" detail="Read inside Chakusa" onPress={() => navigation.navigate('LegalDocument', { page: 'privacy' })} />
      <MenuRow icon="options-outline" tone="slate" title="Cookie preferences" detail="Analytics and marketing choices" onPress={() => navigation.navigate('CookiePreferences')} />
      <MenuRow icon="log-out-outline" tone="red" title={sessionAction === 'all' ? 'Signing out everywhere…' : 'Sign out of all devices'} detail="Revoke every active Chakusa session" disabled={Boolean(sessionAction)} onPress={confirmLogoutAll} />
      <MenuRow icon="trash-outline" tone="red" title="Delete account" detail="Permanently remove your Chakusa account" onPress={() => navigation.navigate('DeleteAccount')} destructive last />
    </MenuSection>

    <Pressable accessibilityRole="button" accessibilityLabel="Sign out of this device" disabled={Boolean(sessionAction)} onPress={confirmLogout} style={({ pressed }) => [styles.logout, pressed && styles.logoutPressed, sessionAction && styles.disabled]}><Ionicons name="exit-outline" size={21} color={colors.negative} /><Text style={styles.logoutText}>{sessionAction === 'logout' ? 'Signing out…' : 'Sign out'}</Text></Pressable>
  </Screen>;
}

function MenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Text style={styles.sectionTitle}>{title}</Text><View style={styles.menuCard}>{children}</View></View>;
}
function MenuRow({ icon, tone, title, detail, onPress, last, destructive = false, disabled = false }: { icon: IconName; tone: MenuTone; title: string; detail?: string; onPress?: () => void; last?: boolean; destructive?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={detail ? `${title}. ${detail}` : title} accessibilityState={{ disabled }} disabled={!onPress || disabled} onPress={onPress} style={({ pressed }) => [styles.menuRow, !last && styles.menuBorder, pressed && styles.rowPressed, disabled && styles.disabled]}>
    <View style={[styles.menuIcon, styles[`icon_${tone}`]]}><Ionicons name={icon} size={20} color={destructive ? colors.negative : iconColors[tone]} /></View>
    <View style={styles.menuCopy}><Text style={[styles.menuTitle, destructive && styles.destructive]}>{title}</Text>{detail ? <Text numberOfLines={2} style={styles.menuDetail}>{detail}</Text> : null}</View>
    {onPress ? <Ionicons name="chevron-forward" size={19} color={colors.tabInactive} /> : null}
  </Pressable>;
}

const iconColors: Record<MenuTone, string> = { red: colors.primary, purple: '#8B5CF6', amber: '#E58A00', green: '#159A7E', blue: '#3578E5', slate: colors.textSecondary };
const styles = StyleSheet.create({
  screen: { gap: spacing.xl },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  businessCard: { minHeight: 116, flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, ...shadows.card },
  businessAvatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary },
  businessInitials: { ...typography.heading, color: colors.surface },
  businessCopy: { flex: 1, minWidth: 0, gap: 2 },
  businessName: { ...typography.subheading, color: colors.text },
  businessMeta: { ...typography.caption, color: colors.textSecondary },
  planBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, marginTop: spacing.xs, paddingHorizontal: spacing.xs, paddingVertical: spacing.xxs, borderRadius: radius.round, backgroundColor: colors.successSoft, borderWidth: 1, borderColor: colors.success },
  planText: { ...typography.micro, color: colors.text },
  section: { gap: spacing.xs }, sectionTitle: { ...typography.micro, color: colors.textSecondary, letterSpacing: 1 },
  menuCard: { paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  menuRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm }, menuBorder: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  menuIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  icon_red: { backgroundColor: '#FFF0F0' }, icon_purple: { backgroundColor: '#F4EEFF' }, icon_amber: { backgroundColor: '#FFF5E5' }, icon_green: { backgroundColor: '#E9F9F5' }, icon_blue: { backgroundColor: '#EDF4FF' }, icon_slate: { backgroundColor: colors.background },
  menuCopy: { flex: 1, minWidth: 0 }, menuTitle: { ...typography.bodyStrong, color: colors.text }, menuDetail: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  logout: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, borderRadius: radius.lg, backgroundColor: colors.negativeSoft, borderWidth: 1, borderColor: '#FAD9DC' }, logoutPressed: { backgroundColor: '#FDEBED' }, logoutText: { ...typography.bodyStrong, color: colors.negative },
  destructive: { color: colors.negative }, pressed: { opacity: 0.72 }, rowPressed: { opacity: 0.68 }, disabled: { opacity: 0.48 },
});
