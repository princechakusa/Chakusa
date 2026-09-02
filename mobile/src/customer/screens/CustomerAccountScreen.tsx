import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppHeader, Avatar, Divider, Screen, SectionHeader } from '../../components/ui';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { useCustomerAuth } from '../CustomerAuthContext';
import type { CustomerRootStackParamList } from '../navigation/types';

type Nav = NativeStackNavigationProp<CustomerRootStackParamList>;
type IconName = keyof typeof Ionicons.glyphMap;

// PROGRAM 2 LOOP 7: Customer Account. Profile summary, the settings the
// customer backend actually supports, legal links, the intentional "My
// Rewards" location (full experience is Loop 8), sign out, and close
// account.

function MenuRow({ icon, label, detail, onPress }: { icon: IconName; label: string; detail?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <Ionicons name={icon} size={20} color={colors.text} />
      <Text style={styles.rowLabel}>{label}</Text>
      {detail ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.tabInactive} />
    </Pressable>
  );
}

export function CustomerAccountScreen() {
  const navigation = useNavigation<Nav>();
  const { user, profile, logout, closeAccount } = useCustomerAuth();

  const confirmClose = () => {
    Alert.alert(
      'Close your account?',
      'This permanently deletes your Chakusa customer account and cannot be undone.',
      [
        { text: 'Keep account', style: 'cancel' },
        {
          text: 'Close account',
          style: 'destructive',
          onPress: async () => {
            try { await closeAccount(); }
            catch (caught) { Alert.alert('Could not close account', caught instanceof ApiError ? caught.message : 'Please try again.'); }
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <AppHeader eyebrow="ACCOUNT" title="You" />

      <View style={styles.identity}>
        <Avatar name={profile?.displayName ?? user?.fullName ?? user?.email ?? 'You'} />
        <View style={styles.identityCopy}>
          <Text style={styles.name}>{profile?.displayName ?? user?.fullName ?? 'Your account'}</Text>
          <Text style={styles.email}>{user?.email}</Text>
        </View>
      </View>

      <SectionHeader title="Profile & preferences" />
      <View style={styles.group}>
        <MenuRow icon="person-outline" label="Edit profile" onPress={() => navigation.navigate('EditCustomerProfile')} />
        <Divider />
        <MenuRow icon="notifications-outline" label="Notifications" onPress={() => navigation.navigate('CustomerNotifications')} />
      </View>

      <SectionHeader title="Rewards" />
      <View style={styles.group}>
        <MenuRow icon="gift-outline" label="My Rewards" onPress={() => navigation.navigate('CustomerRewards')} />
        <Divider />
        <MenuRow icon="people-outline" label="Invite friends" onPress={() => navigation.navigate('CustomerReferrals')} />
      </View>

      <SectionHeader title="Legal" />
      <View style={styles.group}>
        <MenuRow icon="document-text-outline" label="Terms of Service" onPress={() => navigation.navigate('CustomerLegalDocument', { type: 'TERMS_OF_SERVICE' })} />
        <Divider />
        <MenuRow icon="lock-closed-outline" label="Privacy Policy" onPress={() => navigation.navigate('CustomerLegalDocument', { type: 'PRIVACY_POLICY' })} />
      </View>

      <SectionHeader title="Session" />
      <View style={styles.group}>
        <MenuRow icon="log-out-outline" label="Sign out" onPress={() => void logout()} />
        <Divider />
        <MenuRow icon="trash-outline" label="Close account" onPress={confirmClose} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  identityCopy: { flex: 1, minWidth: 0 },
  name: { ...typography.heading, color: colors.text },
  email: { ...typography.caption, color: colors.textSecondary },
  group: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pressed: { opacity: 0.6 },
  rowLabel: { flex: 1, ...typography.body, color: colors.text },
  rowDetail: { ...typography.caption, color: colors.textSecondary },
});
