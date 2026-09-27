import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState, Screen } from '../../components/ui';
import type { ReferralCodeDto, ReferralOverviewDto } from '../../apiTypes';
import { referralProgress, referralStatusLabel, shareInviteMessage } from '../../domain/loyalty';
import { authColors, authRadius, authShadow, authSpace, authType } from '../../experience/authTheme';
import { ApiError } from '../../services/api';
import { formatDate } from '../../utils/format';
import { ReferralProgressCard } from '../components/loyalty';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerReferrals'>;

// PROGRAM 2 LOOP 8: referrals. `/customer/loyalty/referrals` for progress,
// `/referrals/code` for the invite code + link (the server returns the
// URL - we never build it), `/referrals/redeem` to apply a friend's code.
// Self-referral / double-referral / exhausted-code rules are the server's;
// we just surface its error text.
//
// Visual language matches experience/authTheme.ts, carried over from the
// auth surfaces per the customer-wide restyle to match the Stitch mockups.

function SectionLabel({ title }: { title: string }) {
  return <Text style={styles.sectionLabel}>{title}</Text>;
}

function PrimaryBtn({ label, icon, disabled, onPress }: { label: string; icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.primaryBtn, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      {icon ? <Ionicons name={icon} size={17} color={authColors.onCoral} /> : null}
      <Text style={styles.primaryBtnText}>{label}</Text>
    </Pressable>
  );
}

function SecondaryBtn({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.secondaryBtn, disabled && styles.disabled, pressed && !disabled && styles.pressed]}>
      {disabled ? <ActivityIndicator size="small" color={authColors.ink} /> : null}
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </Pressable>
  );
}

export function CustomerReferralsScreen(_: Props) {
  const [overview, setOverview] = useState<ReferralOverviewDto | null>(null);
  const [code, setCode] = useState<ReferralCodeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [codeBusy, setCodeBusy] = useState(false);
  const [entry, setEntry] = useState('');
  const [entryBusy, setEntryBusy] = useState(false);
  const [entryMessage, setEntryMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setOverview(await loyaltyApi.referrals()); setError(null); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not load your referrals.'); }
    finally { setLoaded(true); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const getCode = async () => {
    setCodeBusy(true);
    try { setCode(await loyaltyApi.referralCode()); }
    catch (caught) { setError(caught instanceof ApiError ? caught.message : 'Could not create your invite code.'); }
    finally { setCodeBusy(false); }
  };

  const share = async () => {
    if (!code) return;
    try { await Share.share({ message: shareInviteMessage(code.code, code.inviteUrl) }); }
    catch { /* user dismissed the share sheet */ }
  };

  const redeem = async () => {
    const value = entry.trim();
    if (!value || entryBusy) return;
    setEntryBusy(true);
    setEntryMessage(null);
    try {
      await loyaltyApi.redeemReferral(value);
      setEntryMessage('Code applied. Book your first appointment to complete the referral.');
      setEntry('');
      await load();
    } catch (caught) {
      setEntryMessage(caught instanceof ApiError ? caught.message : 'That code could not be applied.');
    } finally {
      setEntryBusy(false);
    }
  };

  if (!loaded) return <Screen backgroundColor={authColors.bg}><LoadingState label="Loading referrals…" /></Screen>;
  if (error && !overview) return <Screen backgroundColor={authColors.bg}><ErrorState message={error} onRetry={load} /></Screen>;

  const progress = overview ? referralProgress(overview) : { invited: 0, joined: 0, completed: 0, conversionRate: 0 };

  return (
    <Screen backgroundColor={authColors.bg} refreshing={loaded && !error} onRefresh={() => void load()}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>REFERRALS</Text>
        <Text style={styles.title}>Invite friends</Text>
        <Text style={styles.subtitle}>Share Chakusa and earn rewards when friends book.</Text>
      </View>

      <ReferralProgressCard invited={progress.invited} joined={progress.joined} completed={progress.completed} />

      <SectionLabel title="Your invite" />
      {code ? (
        <View style={styles.card}>
          <Text style={styles.code}>{code.code}</Text>
          <Text style={styles.meta}>{code.inviteUrl}</Text>
          <PrimaryBtn icon="share-outline" label="Share invite" onPress={() => void share()} />
        </View>
      ) : (
        <SecondaryBtn label={codeBusy ? 'Please wait…' : 'Get my invite code'} disabled={codeBusy} onPress={() => void getCode()} />
      )}

      <SectionLabel title="Have a code?" />
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={entry}
          onChangeText={setEntry}
          placeholder="Enter a friend’s referral code"
          placeholderTextColor={authColors.inkFaint}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <PrimaryBtn label={entryBusy ? 'Applying…' : 'Apply code'} disabled={entryBusy || !entry.trim()} onPress={() => void redeem()} />
        {entryMessage ? <Text style={styles.entryMessage}>{entryMessage}</Text> : null}
      </View>

      <SectionLabel title="Friends you’ve invited" />
      {!overview || !overview.referrals.length ? (
        <EmptyState icon="people-outline" title="No invites yet" message="Share your code above - friends who join and book will show up here." />
      ) : (
        <View style={styles.list}>
          {overview.referrals.map((referral) => (
            <View key={referral.id} style={styles.referralRow}>
              <View style={styles.copy}>
                <Text style={styles.name}>{referral.refereeName}</Text>
                <Text style={styles.meta}>{referralStatusLabel(referral.status)}{referral.completedAt ? ` · ${formatDate(referral.completedAt)}` : referral.joinedAt ? ` · ${formatDate(referral.joinedAt)}` : ''}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: authSpace.sm },
  eyebrow: { ...authType.micro, color: authColors.coral },
  title: { ...authType.title, marginTop: 2 },
  subtitle: { ...authType.body, fontSize: 13, marginTop: 2 },
  sectionLabel: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 16, color: authColors.ink, marginTop: authSpace.md, marginBottom: authSpace.xs },
  card: { backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, padding: authSpace.md, gap: authSpace.sm, ...authShadow.card },
  code: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 20, color: authColors.ink, letterSpacing: 1 },
  meta: { ...authType.body, fontSize: 12 },
  input: { minHeight: 48, borderRadius: authRadius.md, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.bgSunk, paddingHorizontal: authSpace.md, ...authType.body, fontSize: 15, color: authColors.ink },
  entryMessage: { ...authType.body, fontSize: 12 },
  list: { gap: authSpace.xs },
  referralRow: { flexDirection: 'row', alignItems: 'center', padding: authSpace.md, backgroundColor: authColors.surface, borderRadius: authRadius.lg, borderWidth: 1, borderColor: authColors.line, ...authShadow.card },
  copy: { flex: 1, minWidth: 0 },
  name: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 14, color: authColors.ink },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs, minHeight: 52, borderRadius: authRadius.pill, backgroundColor: authColors.coral, ...authShadow.cta },
  primaryBtnText: { fontFamily: 'PlusJakartaSans_700Bold', fontSize: 15, color: authColors.onCoral },
  secondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: authSpace.xs, minHeight: 52, borderRadius: authRadius.pill, borderWidth: 1, borderColor: authColors.line, backgroundColor: authColors.surface },
  secondaryBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: authColors.ink },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
