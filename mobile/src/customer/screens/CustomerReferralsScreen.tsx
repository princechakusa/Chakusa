import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useState } from 'react';
import { Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppHeader, EmptyState, ErrorState, LoadingState, PrimaryButton, Screen, SecondaryButton, SectionHeader } from '../../components/ui';
import type { ReferralCodeDto, ReferralOverviewDto } from '../../apiTypes';
import { referralProgress, referralStatusLabel, shareInviteMessage } from '../../domain/loyalty';
import { ApiError } from '../../services/api';
import { colors, radius, spacing, typography } from '../../theme';
import { formatDate } from '../../utils/format';
import { ReferralProgressCard } from '../components/loyalty';
import { loyaltyApi } from '../endpoints';
import type { CustomerRootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<CustomerRootStackParamList, 'CustomerReferrals'>;

// PROGRAM 2 LOOP 8: referrals. `/customer/loyalty/referrals` for progress,
// `/referrals/code` for the invite code + link (the server returns the
// URL — we never build it), `/referrals/redeem` to apply a friend's code.
// Self-referral / double-referral / exhausted-code rules are the server's;
// we just surface its error text.

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

  if (!loaded) return <Screen><LoadingState label="Loading referrals…" /></Screen>;
  if (error && !overview) return <Screen><ErrorState message={error} onRetry={load} /></Screen>;

  const progress = overview ? referralProgress(overview) : { invited: 0, joined: 0, completed: 0, conversionRate: 0 };

  return (
    <Screen refreshing={loaded && !error} onRefresh={() => void load()}>
      <AppHeader eyebrow="REFERRALS" title="Invite friends" subtitle="Share Chakusa and earn rewards when friends book." />

      <ReferralProgressCard invited={progress.invited} joined={progress.joined} completed={progress.completed} />

      <SectionHeader title="Your invite" />
      {code ? (
        <View style={styles.card}>
          <Text style={styles.code}>{code.code}</Text>
          <Text style={styles.meta}>{code.inviteUrl}</Text>
          <PrimaryButton fullWidth icon="share-outline" label="Share invite" onPress={() => void share()} />
        </View>
      ) : (
        <SecondaryButton fullWidth label={codeBusy ? 'Please wait…' : 'Get my invite code'} disabled={codeBusy} onPress={() => void getCode()} />
      )}

      <SectionHeader title="Have a code?" />
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={entry}
          onChangeText={setEntry}
          placeholder="Enter a friend’s referral code"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        <PrimaryButton fullWidth label={entryBusy ? 'Applying…' : 'Apply code'} disabled={entryBusy || !entry.trim()} onPress={() => void redeem()} />
        {entryMessage ? <Text style={styles.entryMessage}>{entryMessage}</Text> : null}
      </View>

      <SectionHeader title="Friends you’ve invited" />
      {!overview || !overview.referrals.length ? (
        <EmptyState icon="people-outline" title="No invites yet" message="Share your code above — friends who join and book will show up here." />
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
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  code: { ...typography.heading, color: colors.text, letterSpacing: 1 },
  meta: { ...typography.caption, color: colors.textSecondary },
  input: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background, paddingHorizontal: spacing.md, ...typography.body, color: colors.text },
  entryMessage: { ...typography.caption, color: colors.textSecondary },
  list: { gap: spacing.xs },
  referralRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  copy: { flex: 1, minWidth: 0 },
  name: { ...typography.bodyStrong, color: colors.text },
});
