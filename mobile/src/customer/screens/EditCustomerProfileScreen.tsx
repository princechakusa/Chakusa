import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ProfilePhoto } from '../../components/ProfilePhoto';
import { AppHeader, PrimaryButton, Screen, SecondaryButton } from '../../components/ui';
import { ApiError } from '../../services/api';
import { pickProfileImage, ProfileImageError } from '../../services/pickProfileImage';
import { colors, radius, spacing, typography } from '../../theme';
import { customerApi } from '../endpoints';
import { useCustomerAuth } from '../CustomerAuthContext';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'EditCustomerProfile'>;

// PROGRAM 2 LOOP 7: edit the handful of fields `/customer/profile` accepts,
// including the customer's profile picture.

export function EditCustomerProfileScreen({ navigation }: Props) {
  const { profile, refreshProfile } = useCustomerAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [avatar, setAvatar] = useState<string | null>(profile?.avatarUrl ?? null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const avatarChanged = avatar !== (profile?.avatarUrl ?? null);

  const choosePhoto = async () => {
    setPicking(true);
    setError(null);
    try {
      const picked = await pickProfileImage();
      if (picked) setAvatar(picked);
    } catch (caught) {
      setError(caught instanceof ProfileImageError ? caught.message : 'Could not use that photo.');
    } finally {
      setPicking(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await customerApi.updateProfile({ displayName: displayName.trim(), ...(avatarChanged ? { avatarUrl: avatar } : {}) });
      await refreshProfile();
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save your profile.');
      setSaving(false);
    }
  };

  return (
    <Screen>
      <AppHeader eyebrow="PROFILE" title="Edit profile" />
      <View style={styles.photoRow}>
        <ProfilePhoto testID="profile-photo" uri={avatar} name={displayName || profile?.displayName} size={84} />
        <View style={styles.photoActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={avatar ? 'Change photo' : 'Add photo'} disabled={picking} onPress={() => void choosePhoto()} style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]}>
            <Text style={styles.photoButtonText}>{picking ? 'Opening…' : avatar ? 'Change photo' : 'Add photo'}</Text>
          </Pressable>
          {avatar ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => setAvatar(null)} style={({ pressed }) => [styles.photoButton, pressed && styles.pressed]}>
              <Text style={styles.photoButtonText}>Remove</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      {avatarChanged ? <Text style={styles.hint}>Tap Save changes to keep your new photo.</Text> : null}
      <View style={styles.field}>
        <Text style={styles.label}>Display name</Text>
        <TextInput accessibilityLabel="Display name" style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="How businesses see you" placeholderTextColor={colors.textSecondary} autoCapitalize="words" />
      </View>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <PrimaryButton fullWidth label={saving ? 'Saving…' : 'Save changes'} disabled={saving || !displayName.trim()} onPress={() => void save()} />
      <SecondaryButton fullWidth label="Cancel" onPress={() => navigation.goBack()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  photoActions: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', flex: 1 },
  photoButton: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: radius.round, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  photoButtonText: { ...typography.bodyStrong, fontSize: 14, color: colors.text },
  pressed: { opacity: 0.75 },
  hint: { ...typography.caption, color: colors.textSecondary },
  field: { gap: spacing.xs },
  label: { ...typography.caption, color: colors.textSecondary },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, ...typography.body, color: colors.text },
  error: { ...typography.caption, color: colors.negative },
});
