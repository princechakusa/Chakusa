import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useConfirmSheet, useSignOutSheet } from '../../components/ConfirmSheet';
import { Screen } from '../../components/ui';
import { ProfilePhoto } from '../../components/ProfilePhoto';
import { useExperience } from '../../experience/experienceContext';
import { authRadius, authSpace, authType } from '../../experience/authTheme';
import { premium, premiumSerif } from '../premiumTheme';
import { useCustomerAuth } from '../CustomerAuthContext';
import type { CustomerRootStackParamList } from '../navigation/types';
import { copyrightLine } from '../../domain/runtimeConfig';
import { useRuntimeConfig } from '../../services/runtimeConfig';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;
type IconName = keyof typeof Ionicons.glyphMap;

// PROGRAM 2 LOOP 7: Customer Account. Profile summary, the settings the
// customer backend actually supports, legal links, the intentional "My
// Rewards" location (full experience is Loop 8), sign out, and close
// account.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function SectionLabel({ title }: { title: string }) {
  return <Text style={styles.sectionLabel}>{title}</Text>;
}

function Divider() {
  return <View style={styles.divider} />;
}

function MenuRow({ icon, label, detail, onPress, disabled = false, danger = false }: { icon: IconName; label: string; detail?: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.rowDisabled]}>
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}><Ionicons name={icon} size={17} color={danger ? premium.danger : premium.deep} /></View>
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
        {detail ? <Text numberOfLines={1} style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={premium.inkFaint} />
    </Pressable>
  );
}

export function CustomerAccountScreen() {
  const navigation = useNavigation<Nav>();
  const { user, profile, logout, logoutAll } = useCustomerAuth();
  const { company } = useRuntimeConfig();
  const { switching, switchExperience } = useExperience();

  const { confirm, sheet } = useConfirmSheet();
  const { chooseSignOut, sheet: signOutSheet } = useSignOutSheet();
  const confirmSwitch = async () => {
    if (await confirm({ title: 'Switch to business?', message: 'You will go to your Chakusa business tools: bookings, customers and growth. You can switch back any time.', confirmLabel: 'Yes, switch', cancelLabel: 'No, stay here', icon: 'swap-horizontal-outline' })) await switchExperience('business');
  };
  const confirmSignOut = async () => {
    const choice = await chooseSignOut();
    if (choice === 'all') await logoutAll().catch(() => undefined);
    else if (choice === 'device') await logout();
  };

  return (
    <Screen backgroundColor={premium.bg}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>ACCOUNT</Text>
        <Text style={styles.title}>You</Text>
      </View>

      <View style={styles.identity}>
        <ProfilePhoto testID="account-photo" uri={profile?.avatarUrl} name={profile?.displayName ?? user?.fullName ?? user?.email ?? 'You'} size={56} />
        <View style={styles.identityCopy}>
          <Text style={styles.name}>{profile?.displayName ?? user?.fullName ?? 'Your account'}</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>
      </View>

      <SectionLabel title="Profile & preferences" />
      <View style={styles.group}>
        <MenuRow icon="person-outline" label="Edit profile" onPress={() => navigation.navigate('EditCustomerProfile')} />
        <Divider />
        <MenuRow icon="notifications-outline" label="Notifications" onPress={() => navigation.navigate('CustomerNotifications')} />
      </View>

      <SectionLabel title="Billing" />
      <View style={styles.group}>
        <MenuRow icon="receipt-outline" label="Invoices" detail="From businesses you visit" onPress={() => navigation.navigate('CustomerInvoices')} />
      </View>

      <SectionLabel title="Rewards" />
      <View style={styles.group}>
        <MenuRow icon="gift-outline" label="My Rewards" onPress={() => navigation.navigate('CustomerRewards')} />
        <Divider />
        <MenuRow icon="people-outline" label="Invite friends" onPress={() => navigation.navigate('CustomerReferrals')} />
      </View>

      <SectionLabel title="Chakusa" />
      <View style={styles.group}>
        <MenuRow icon="swap-horizontal-outline" label={switching ? 'Switching…' : 'Switch to business'} disabled={switching} onPress={() => void confirmSwitch()} />
      </View>

      <SectionLabel title="Legal" />
      <View style={styles.group}>
        <MenuRow icon="document-text-outline" label="Terms of Service" onPress={() => navigation.navigate('CustomerLegalDocument', { type: 'TERMS_OF_SERVICE' })} />
        <Divider />
        <MenuRow icon="lock-closed-outline" label="Privacy Policy" onPress={() => navigation.navigate('CustomerLegalDocument', { type: 'PRIVACY_POLICY' })} />
      </View>

      <SectionLabel title="Session" />
      <View style={styles.group}>
        <MenuRow icon="log-out-outline" label="Sign out" onPress={() => void confirmSignOut()} />
        <Divider />
        <MenuRow icon="trash-outline" label="Delete account" detail="Permanently erase your account" danger onPress={() => navigation.navigate('CustomerDeleteAccount')} />
      </View>
      <Text style={styles.copyright}>{copyrightLine(company)}</Text>
      {sheet}
      {signOutSheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.md },
  eyebrow: { ...authType.micro, letterSpacing: 1, color: premium.inkFaint },
  title: { fontFamily: premiumSerif, fontSize: 32, lineHeight: 38, color: premium.ink, marginTop: 4 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, marginBottom: authSpace.md, padding: authSpace.md, borderRadius: authRadius.lg, backgroundColor: premium.deep },
  identityCopy: { flex: 1, minWidth: 0 },
  name: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: premium.onDeep },
  email: { ...authType.body, fontSize: 13, color: premium.onDeepSoft },
  sectionLabel: { ...authType.micro, marginTop: authSpace.md, marginBottom: authSpace.xs },
  group: { backgroundColor: premium.card, borderRadius: authRadius.lg, borderWidth: 1, borderColor: premium.line, paddingHorizontal: authSpace.md },
  row: { minHeight: 52, paddingVertical: authSpace.xs, flexDirection: 'row', alignItems: 'center', gap: authSpace.sm },
  rowCopy: { flex: 1, minWidth: 0 },
  rowIconDanger: { backgroundColor: '#F6E4E0' },
  rowLabelDanger: { color: premium.danger },
  rowIcon: { width: 30, height: 30, borderRadius: authRadius.pill, backgroundColor: premium.sageSoft, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  rowDisabled: { opacity: 0.5 },
  rowLabel: { ...authType.body, fontSize: 14, color: premium.ink },
  rowDetail: { ...authType.body, fontSize: 12, lineHeight: 16, color: premium.inkFaint },
  divider: { height: 1, backgroundColor: premium.sageSoft },
  copyright: { ...authType.body, fontSize: 12, color: premium.inkFaint, textAlign: 'center', marginTop: authSpace.lg, marginBottom: authSpace.md },
});
