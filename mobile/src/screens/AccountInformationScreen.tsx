import { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../state/AuthContext';
import { titleCase } from '../utils/format';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Icon, M3Card, M3Header, M3Screen } from '../experience/businessKit';
import { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function AccountInformationScreen() {
  const navigation = useNavigation<Nav>();
  const { user, business, role, linkGoogle, linkApple, updateProfile, changePassword } = useAuth();
  const [linking, setLinking] = useState<'GOOGLE' | 'APPLE' | null>(null);
  const [name, setName] = useState(user?.fullName ?? '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState<'profile' | 'password' | null>(null);
  const providers = user?.authProviders ?? [];

  const link = async (provider: 'GOOGLE' | 'APPLE') => {
    if (linking) return;
    setLinking(provider);
    try {
      const linked = provider === 'GOOGLE' ? await linkGoogle() : await linkApple();
      if (linked) Alert.alert('Account secured', `${provider === 'GOOGLE' ? 'Google' : 'Apple'} is now connected to your Chakusa account.`);
    } catch (error) {
      Alert.alert('Could not connect account', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLinking(null);
    }
  };
  const saveProfile = async () => {
    if (saving || !name.trim()) return;
    setSaving('profile');
    try {
      await updateProfile(name.trim());
      Alert.alert('Profile updated', 'Your name has been saved.');
    } catch (error) {
      Alert.alert('Could not update profile', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(null);
    }
  };
  const savePassword = async () => {
    if (saving || newPassword.length < 8) return;
    setSaving('password');
    try {
      await changePassword(user?.hasPassword ? currentPassword : undefined, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      Alert.alert('Password updated', 'Other signed-in devices have been logged out for your security.');
    } catch (error) {
      Alert.alert('Could not update password', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSaving(null);
    }
  };

  const header = (
    <M3Header
      businessName="More" onBack={() => navigation.goBack()}
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      onAvatarPress={() => navigation.navigate('Main', { screen: 'Settings' })}
      hasNotifications={false}
    />
  );

  return (
    <M3Screen header={header}>
      <View style={styles.titleBlock}>
        <Text style={styles.title}>Security & Authentication</Text>
        <Text style={styles.subtitle}>Your identity, sign-in methods, and business membership.</Text>
      </View>

      <Text style={styles.sectionTitle}>IDENTITY</Text>
      <M3Card padded={false} style={styles.card}>
        <Field icon="mail" label="Email" value={user?.email} />
        <Field icon="storefront" label="Business" value={business?.name} />
        <Field icon="verified_user" label="Role" value={role ? titleCase(role) : undefined} last />
      </M3Card>

      <M3Card style={styles.editor}>
        <Text style={styles.editorTitle}>Edit profile</Text>
        <TextInput
          accessibilityLabel="Full name"
          value={name}
          onChangeText={setName}
          placeholder="Full name"
          placeholderTextColor={m3.onSurfaceVariant}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={Boolean(saving) || !name.trim()}
          onPress={() => void saveProfile()}
          style={[styles.primaryBtn, (Boolean(saving) || !name.trim()) && styles.disabled]}
        >
          <Text style={styles.primaryBtnText}>{saving === 'profile' ? 'Saving…' : 'Save name'}</Text>
        </Pressable>
      </M3Card>

      <Text style={styles.sectionTitle}>SIGN-IN METHODS</Text>
      <M3Card padded={false} style={styles.card}>
        <ProviderRow connected={providers.includes('GOOGLE')} label="Google" icon="account_circle" loading={linking === 'GOOGLE'} onConnect={() => void link('GOOGLE')} />
        {Platform.OS === 'ios' ? (
          <ProviderRow connected={providers.includes('APPLE')} label="Apple" icon="apple" loading={linking === 'APPLE'} onConnect={() => void link('APPLE')} />
        ) : null}
        {user?.hasPassword ? (
          <View style={styles.providerRow}>
            <Icon name="password" size={20} color={m3.onSurfaceVariant} />
            <View style={styles.flex}>
              <Text style={styles.providerLabel}>Email and password</Text>
              <Text style={styles.providerDetail}>Connected</Text>
            </View>
            <Icon name="check_circle" size={20} color={m3.secondary} />
          </View>
        ) : null}
      </M3Card>

      <M3Card style={styles.editor}>
        <Text style={styles.editorTitle}>{user?.hasPassword ? 'Change password' : 'Create a password'}</Text>
        {user?.hasPassword ? (
          <TextInput
            accessibilityLabel="Current password"
            secureTextEntry
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Current password"
            placeholderTextColor={m3.onSurfaceVariant}
            style={styles.input}
          />
        ) : null}
        <TextInput
          accessibilityLabel="New password"
          secureTextEntry
          value={newPassword}
          onChangeText={setNewPassword}
          placeholder="New password (8+ characters)"
          placeholderTextColor={m3.onSurfaceVariant}
          style={styles.input}
        />
        <Pressable
          accessibilityRole="button"
          disabled={Boolean(saving) || newPassword.length < 8 || Boolean(user?.hasPassword && !currentPassword)}
          onPress={() => void savePassword()}
          style={[
            styles.primaryBtn,
            (Boolean(saving) || newPassword.length < 8 || Boolean(user?.hasPassword && !currentPassword)) && styles.disabled,
          ]}
        >
          <Text style={styles.primaryBtnText}>
            {saving === 'password' ? 'Updating…' : user?.hasPassword ? 'Change password' : 'Create password'}
          </Text>
        </Pressable>
      </M3Card>

      <View style={styles.notice}>
        <Icon name="info" size={18} color={m3.primary} />
        <Text style={styles.noticeText}>
          Signing out of this device does not affect your other devices. Password changes sign out other devices
          automatically.
        </Text>
      </View>
    </M3Screen>
  );
}

function Field({ icon, label, value, last }: { icon: string; label: string; value?: string | null; last?: boolean }) {
  return (
    <View style={[styles.field, !last && styles.border]}>
      <Icon name={icon} size={19} color={m3.onSurfaceVariant} />
      <View style={styles.flex}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text selectable style={styles.fieldValue}>
          {value || 'Not available'}
        </Text>
      </View>
    </View>
  );
}

function ProviderRow({
  connected,
  label,
  icon,
  loading,
  onConnect,
}: {
  connected: boolean;
  label: string;
  icon: string;
  loading: boolean;
  onConnect: () => void;
}) {
  return (
    <View style={[styles.providerRow, styles.border]}>
      <Icon name={icon} size={20} color={m3.onSurfaceVariant} />
      <View style={styles.flex}>
        <Text style={styles.providerLabel}>{label}</Text>
        <Text style={styles.providerDetail}>{connected ? 'Connected' : 'Not connected'}</Text>
      </View>
      {connected ? (
        <Icon name="check_circle" size={20} color={m3.secondary} />
      ) : (
        <Pressable accessibilityRole="button" disabled={loading} onPress={onConnect} style={styles.connectBtn}>
          <Text style={styles.connectText}>{loading ? 'Connecting…' : 'Connect'}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  disabled: { opacity: 0.5 },

  titleBlock: { gap: 2 },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant },

  sectionTitle: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.6, paddingHorizontal: 2, marginTop: 4 },
  card: { paddingHorizontal: m3Space.md },
  field: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  border: { borderBottomWidth: 1, borderBottomColor: m3.surfaceContainerHigh },
  fieldLabel: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0 },
  fieldValue: { ...m3Type.labelLg, color: m3.onSurface, marginTop: 1 },

  editor: { gap: m3Space.sm },
  editorTitle: { ...m3Type.titleMd, color: m3.onSurface },
  input: {
    minHeight: 48,
    borderRadius: m3Radius.sm,
    backgroundColor: m3.surfaceContainerLow,
    paddingHorizontal: m3Space.md,
    ...m3Type.bodyMd,
    color: m3.onSurface,
  },
  primaryBtn: { height: 46, borderRadius: m3Radius.md, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { ...m3Type.labelLg, color: m3.onPrimary },

  providerRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  providerLabel: { ...m3Type.labelLg, color: m3.onSurface },
  providerDetail: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  connectBtn: { height: 36, paddingHorizontal: 16, borderRadius: m3Radius.full, backgroundColor: m3.primaryFixed, alignItems: 'center', justifyContent: 'center' },
  connectText: { ...m3Type.labelMd, color: m3.onPrimaryFixedVariant },

  notice: { flexDirection: 'row', alignItems: 'flex-start', gap: m3Space.xs, borderRadius: m3Radius.md, backgroundColor: 'rgba(171,45,25,0.08)', padding: m3Space.md },
  noticeText: { ...m3Type.bodySm, color: m3.onSurface, flex: 1 },
});
