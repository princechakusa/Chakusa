import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AppHeader, PrimaryButton, Screen, SecondaryButton } from '../../components/ui';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { customerApi } from '../endpoints';
import { useCustomerAuth } from '../CustomerAuthContext';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'EditCustomerProfile'>;

// PROGRAM 2 LOOP 7: edit the handful of fields `/customer/profile` accepts.

export function EditCustomerProfileScreen({ navigation }: Props) {
  const { profile, refreshProfile } = useCustomerAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await customerApi.updateProfile({ displayName: displayName.trim() });
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
      <View style={styles.field}>
        <Text style={styles.label}>Display name</Text>
        <TextInput style={styles.input} value={displayName} onChangeText={setDisplayName} placeholder="How businesses see you" placeholderTextColor={colors.textSecondary} autoCapitalize="words" />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton fullWidth label={saving ? 'Saving…' : 'Save changes'} disabled={saving || !displayName.trim()} onPress={() => void save()} />
      <SecondaryButton fullWidth label="Cancel" onPress={() => navigation.goBack()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { ...typography.caption, color: colors.textSecondary },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: spacing.md, ...typography.body, color: colors.text },
  error: { ...typography.caption, color: colors.negative },
});
