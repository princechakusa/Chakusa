import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PublicTeamInvitationDto } from '../apiTypes';
import { AuthForm } from '../components/AuthForm';
import { AppHeader, ErrorState, LoadingState, PrimaryButton, Screen, StatusBadge } from '../components/ui';
import { publicInviteStateCopy, roleLabel, shouldBypassOwnerOnboarding, teamErrorCopy } from '../domain/team';
import { ApiError } from '../services/api';
import { publicTeamInvitesApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { usePreferences } from '../state/PreferencesContext';
import { colors, radius, spacing, typography } from '../theme';
import { RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'TeamInvite'>;
export function TeamInviteScreen({ route, navigation }: Props) {
  const token = route.params.token; const { status, role, restore } = useAuth(); const { refresh: refreshPlan } = usePlanExperience(); const preferences = usePreferences();
  const [invite, setInvite] = useState<PublicTeamInvitationDto | null>(null); const [loaded, setLoaded] = useState(false); const [error, setError] = useState<string | null>(null); const [accepting, setAccepting] = useState(false); const [joined, setJoined] = useState(false);
  const attemptedAcceptance = useRef(false);
  const load = useCallback(async () => { if (!token) { setLoaded(true); setError('This invitation is unavailable.'); return; } try { setInvite(await publicTeamInvitesApi.get(token)); setError(null); } catch { setError('This invitation is unavailable.'); } finally { setLoaded(true); } }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (status === 'authenticated' && shouldBypassOwnerOnboarding(role)) { preferences.completeOnboarding(); setJoined(true); } }, [preferences, role, status]);
  const accept = async () => { if (!token || accepting) return; setAccepting(true); setError(null); try { const result = await publicTeamInvitesApi.accept(token); if (result.state === 'accepted') { await restore(); await refreshPlan(); } else if (result.state === 'expired') setInvite({ state: 'expired' }); else if (result.state === 'already-used') setInvite({ state: 'accepted' }); } catch (caught) { setError(caught instanceof ApiError && caught.kind === 'conflict' ? teamErrorCopy(caught.code, caught.message) : caught instanceof ApiError && caught.kind === 'not-found' ? 'This invitation was sent to a different email address or is no longer available.' : 'Couldn’t accept this invitation. Please try again.'); } finally { setAccepting(false); } };
  useEffect(() => { if (status === 'authenticated' && invite?.state === 'open' && !shouldBypassOwnerOnboarding(role) && !attemptedAcceptance.current) { attemptedAcceptance.current = true; void accept(); } }, [invite?.state, role, status]);
  const openApp = () => { preferences.completeOnboarding(); navigation.reset({ index: 0, routes: [{ name: 'Main' }] }); };
  if (!loaded) return <Screen><LoadingState label="Loading invitation…" /></Screen>;
  if (error && !invite) return <Screen><ErrorState message={error} onRetry={() => void load()} /></Screen>;
  if (!invite) return <Screen><ErrorState message="This invitation is unavailable." onRetry={() => void load()} /></Screen>;
  if (joined) return <Screen><AppHeader eyebrow="TEAM INVITATION" title="You joined the team" subtitle="Your Chakusa workspace is ready." /><PrimaryButton fullWidth label="Open Chakusa" onPress={openApp} /></Screen>;
  if (invite.state !== 'open') return <Screen><AppHeader eyebrow="TEAM INVITATION" title={publicInviteStateCopy(invite.state)} subtitle="Ask the Business owner for a new invitation if you still need access." />{status === 'authenticated' && shouldBypassOwnerOnboarding(role) ? <PrimaryButton fullWidth label="Open Chakusa" onPress={openApp} /> : null}</Screen>;
  return <Screen><AppHeader eyebrow="TEAM INVITATION" title={`Join ${invite.business?.name ?? 'this Chakusa Business'}`} subtitle="You’ve been invited to work with this team in Chakusa." /><View style={styles.card}><Text style={styles.email}>{invite.email}</Text>{invite.role ? <StatusBadge label={roleLabel(invite.role)} /> : null}<Text style={styles.body}>{invite.role === 'ADMIN' ? 'Admins help with daily business operations.' : 'Staff work with customers, leads, reviews, and daily tasks.'}</Text></View>{status === 'authenticated' ? <><PrimaryButton fullWidth disabled={accepting} label={accepting ? 'Joining team…' : 'Accept invitation'} onPress={() => void accept()} />{error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}</> : <View style={styles.auth}><Text style={styles.heading}>Sign in or create an account</Text><Text style={styles.body}>Use {invite.email ?? 'the invited email address'} so Chakusa can verify this invitation.</Text><AuthForm invitationToken={token} invitedEmail={invite.email} defaultMode="register" onSuccess={() => undefined} /></View>}</Screen>;
}
const styles = StyleSheet.create({ card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.lg, gap: spacing.sm }, auth: { gap: spacing.md }, heading: { ...typography.subheading, color: colors.text }, email: { ...typography.bodyStrong, color: colors.text }, body: { ...typography.body, color: colors.textSecondary }, error: { ...typography.body, color: colors.negative } });
