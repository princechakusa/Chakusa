import { Ionicons } from '../../components/icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ProfilePhoto } from '../../components/ProfilePhoto';
import { SelectField, type SelectFieldTheme } from '../../components/SelectField';
import { LANGUAGES, timezoneOptions } from '../../domain/regionOptions';
import { Screen } from '../../components/ui';
import { authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { pickProfileImage, ProfileImageError } from '../../services/pickProfileImage';
import { customerApi } from '../endpoints';
import { useCustomerAuth } from '../CustomerAuthContext';
import type { CustomerRootStackParamList } from '../navigation/types';
import { premium } from '../premiumTheme';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'EditCustomerProfile'>;

// PROGRAM 2 LOOP 7: edit the handful of fields `/customer/profile` accepts.
// Visual language matches the warm-cream / pill design used across the
// Chakusa entry surfaces (see experience/authTheme.ts), carried into the
// customer account surface.

function SectionCard({ icon, title, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.cardIcon}>
          <Ionicons name={icon} size={16} color={premium.deep} />
        </View>
        <Text style={styles.cardTitle}>{title}</Text>
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function Field({ label, badge, ...rest }: { label: string; badge?: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldLabelRow}>
        <Text style={styles.label}>{label}</Text>
        {badge ? (
          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={11} color={'#1E7A55'} />
            <Text style={styles.badgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <TextInput placeholderTextColor={premium.inkFaint} {...rest} style={[styles.input, rest.style]} />
    </View>
  );
}


export function EditCustomerProfileScreen({ navigation }: Props) {
  const { profile, user, refreshProfile } = useCustomerAuth();
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [phone, setPhone] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState(profile?.preferredLanguage ?? '');
  const [preferredTimezone, setPreferredTimezone] = useState(profile?.preferredTimezone ?? '');
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
      await customerApi.updateProfile({
        displayName: displayName.trim(),
        preferredLanguage: preferredLanguage.trim() || undefined,
        preferredTimezone: preferredTimezone.trim() || undefined,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(avatarChanged ? { avatarUrl: avatar } : {}),
      });
      await refreshProfile();
      navigation.goBack();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save your profile.');
      setSaving(false);
    }
  };

  return (
    <Screen style={styles.screen} backgroundColor={premium.bg} scroll>
      <View style={styles.headerRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="arrow-back" size={20} color={premium.ink} />
        </Pressable>
        <Text style={styles.heading}>Edit Profile</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.photoWrap}>
        <ProfilePhoto testID="profile-photo" uri={avatar} name={displayName || profile?.displayName} size={96} />
        <Pressable accessibilityRole="button" accessibilityLabel={avatar ? 'Change photo' : 'Add photo'} disabled={picking} onPress={() => void choosePhoto()} style={styles.cameraBtn}>
          {picking ? <ActivityIndicator size="small" color={premium.onDeep} /> : <Ionicons name="camera" size={16} color={premium.onDeep} />}
        </Pressable>
      </View>
      {avatar ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => setAvatar(null)}>
          <Text style={styles.removePhoto}>Remove photo</Text>
        </Pressable>
      ) : null}
      {avatarChanged ? <Text style={styles.hint}>Tap Save changes to keep your new photo.</Text> : null}

      <SectionCard icon="person" title="Personal Identity">
        <Field label="Display name" value={displayName} onChangeText={setDisplayName} placeholder="How businesses see you" autoCapitalize="words" accessibilityLabel="Display name" />
      </SectionCard>

      <SectionCard icon="call" title="Contact Information">
        <Field label="Email" value={user?.email ?? ''} editable={false} badge="Primary" accessibilityLabel="Email" style={styles.inputDisabled} />
        <Field label="Phone number" value={phone} onChangeText={setPhone} placeholder="Add a phone number" keyboardType="phone-pad" accessibilityLabel="Phone number" />
      </SectionCard>

      <SectionCard icon="options" title="Preferences & Privacy">
        <View style={styles.field}>
          <SelectField label="Preferred language" title="Choose your language" searchPlaceholder="Search language" value={preferredLanguage} options={LANGUAGES} onChange={setPreferredLanguage} placeholder="Choose a language" theme={selectTheme} />
        </View>
        <View style={styles.field}>
          <SelectField label="Preferred time zone" title="Choose your time zone" searchPlaceholder="Search city or region" value={preferredTimezone} options={timezoneOptions()} onChange={setPreferredTimezone} placeholder="Choose a time zone" theme={selectTheme} />
        </View>
      </SectionCard>

      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

      <Pressable accessibilityRole="button" disabled={saving || !displayName.trim()} onPress={() => void save()} style={({ pressed }) => [styles.saveBtn, (saving || !displayName.trim()) && styles.disabled, pressed && styles.pressed]}>
        {saving ? <ActivityIndicator color={premium.onDeep} /> : <Text style={styles.saveBtnText}>Save changes</Text>}
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} style={({ pressed }) => [styles.discardBtn, pressed && styles.pressed]}>
        <Text style={styles.discardBtnText}>Discard changes</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: premium.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: authSpace.md },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  heading: { ...authType.title, fontFamily: 'PlusJakartaSans_700Bold' },
  photoWrap: { alignSelf: 'center', marginTop: authSpace.sm },
  cameraBtn: { position: 'absolute', right: -2, bottom: -2, width: 32, height: 32, borderRadius: authRadius.pill, backgroundColor: premium.deep, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: premium.bg, ...authShadow.cta },
  removePhoto: { ...authType.link, alignSelf: 'center', marginTop: authSpace.xs },
  hint: { ...authType.micro, alignSelf: 'center', marginTop: authSpace.xxs, textTransform: 'none', letterSpacing: 0 },
  card: { marginTop: authSpace.lg, borderRadius: authRadius.lg, backgroundColor: premium.card, borderWidth: 1, borderColor: premium.line, padding: authSpace.md, ...authShadow.card },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: authSpace.xs, marginBottom: authSpace.sm },
  cardIcon: { width: 28, height: 28, borderRadius: authRadius.pill, backgroundColor: premium.sageSoft, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...authType.cardTitle, fontSize: 15 },
  cardBody: { gap: authSpace.sm },
  field: { gap: authSpace.xxs },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...authType.micro, textTransform: 'none', letterSpacing: 0, fontSize: 12, color: premium.inkSoft },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: authSpace.xs, paddingVertical: 2, borderRadius: authRadius.pill, backgroundColor: '#EAF9F1' },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: '#1E7A55' },
  input: { minHeight: 48, borderRadius: authRadius.md, borderWidth: 1, borderColor: premium.line, backgroundColor: premium.sageSoft, paddingHorizontal: authSpace.sm, ...authType.body, color: premium.ink, fontSize: 15 },
  inputDisabled: { color: premium.inkFaint },
  saveBtn: { marginTop: authSpace.xl, minHeight: 52, borderRadius: authRadius.pill, backgroundColor: premium.deep, alignItems: 'center', justifyContent: 'center', ...authShadow.cta },
  saveBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.onDeep },
  discardBtn: { marginTop: authSpace.sm, minHeight: 52, borderRadius: authRadius.pill, backgroundColor: premium.card, borderWidth: 1, borderColor: premium.line, alignItems: 'center', justifyContent: 'center' },
  discardBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: premium.ink },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  error: { ...authType.body, color: premium.danger, marginTop: authSpace.md },
});

const selectTheme: SelectFieldTheme = {
  label: styles.label,
  trigger: [styles.input, { marginTop: authSpace.xxs }],
  triggerText: { ...authType.body, color: premium.ink, fontSize: 15 },
  placeholder: premium.inkFaint,
  icon: premium.inkSoft,
  accent: premium.deep,
  sheetBg: premium.card,
  ink: premium.ink,
  inkSoft: premium.inkSoft,
  line: premium.line,
  selectedBg: premium.sageSoft,
  font: 'Inter_400Regular',
  fontMedium: 'Inter_600SemiBold',
};
