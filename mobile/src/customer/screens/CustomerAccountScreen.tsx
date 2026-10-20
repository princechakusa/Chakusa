import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useConfirmSheet } from '../../components/ConfirmSheet';
import { Screen } from '../../components/ui';
import { ProfilePhoto } from '../../components/ProfilePhoto';
import { useExperience } from '../../experience/experienceContext';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { useCustomerAuth } from '../CustomerAuthContext';
import type { CustomerRootStackParamList } from '../navigation/types';

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
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}><Ionicons name={icon} size={17} color={danger ? authColors.danger : authColors.coral} /></View>
      <View style={styles.rowCopy}>
        <Text numberOfLines={1} style={[styles.rowLabel, danger && styles.rowLabelDanger]}>{label}</Text>
        {detail ? <Text numberOfLines={1} style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={18} color={authColors.inkFaint} />
    </Pressable>
  );
}

export function CustomerAccountScreen() {
  const navigation = useNavigation<Nav>();
  const { user, profile, logout } = useCustomerAuth();
  const { switching, switchExperience } = useExperience();

  const { confirm, sheet } = useConfirmSheet();
  const confirmSignOut = async () => {
    if (await confirm({ title: 'Sign out?', message: 'You can sign back in any time with the same account.', confirmLabel: 'Yes, sign out', cancelLabel: 'No, stay signed in', destructive: true, icon: 'log-out-outline' })) await logout();
  };

  return (
    <Screen backgroundColor={authColors.bg}>
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
        <MenuRow icon="swap-horizontal-outline" label={switching ? 'Switching…' : 'Switch to business'} disabled={switching} onPress={() => switchExperience('business')} />
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
      {sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.md },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: authSpace.sm, marginBottom: authSpace.md },
  identityCopy: { flex: 1, minWidth: 0 },
  name: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 17, color: authColors.ink },
  email: { ...authType.body, fontSize: 13 },
  sectionLabel: { ...authType.micro, marginTop: authSpace.md, marginBottom: authSpace.xs },
  group: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, paddingHorizontal: authSpace.md, ...authShadow.card },
  row: { minHeight: 52, paddingVertical: authSpace.xs, flexDirection: 'row', alignItems: 'center', gap: authSpace.sm },
  rowCopy: { flex: 1, minWidth: 0 },
  rowIconDanger: { backgroundColor: '#FDECEC' },
  rowLabelDanger: { color: authColors.danger },
  rowIcon: { width: 30, height: 30, borderRadius: authRadius.pill, backgroundColor: authColors.coralSoft, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  rowDisabled: { opacity: 0.5 },
  rowLabel: { ...authType.body, fontSize: 14, color: authColors.ink },
  rowDetail: { ...authType.body, fontSize: 12, lineHeight: 16, color: authColors.inkFaint },
  divider: { height: 1, backgroundColor: authColors.lineSoft },
});
