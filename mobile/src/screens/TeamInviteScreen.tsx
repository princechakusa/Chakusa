import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PublicTeamInvitationDto } from '../apiTypes';
import { AuthForm } from '../components/AuthForm';
import { PrimaryButton, Screen } from '../components/ui';
import { publicInviteStateCopy, roleLabel, shouldBypassOwnerOnboarding, teamErrorCopy } from '../domain/team';
import { ApiError } from '../services/api';
import { publicTeamInvitesApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { usePreferences } from '../state/PreferencesContext';
import { Chip, Icon, M3Card, M3Error, M3Loading } from '../experience/businessKit';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { RootStackParamList } from '../types';

// Public, pre-auth screen reached via a deep link before sign-in. It stays a
// simple standalone Screen (no app-shell header/tab chrome) but borrows the
// rust/teal token set, type scale, and the role-badge/avatar visual language
// from the businessKit primitives.

type Props = NativeStackScreenProps<RootStackParamList, 'TeamInvite'>;

function InviteHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={styles.headerBlock}>
      <Text style={styles.eyebrow}>TEAM INVITATION</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

function inviteInitial(email?: string | null) {
  return (email ?? '?').trim().charAt(0).toUpperCase() || '?';
}

export function TeamInviteScreen({ route, navigation }: Props) {
  const token = route.params.token;
  const { status, role, restore } = useAuth();
  const { refresh: refreshPlan } = usePlanExperience();
  const preferences = usePreferences();
  const [invite, setInvite] = useState<PublicTeamInvitationDto | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [joined, setJoined] = useState(false);
  const attemptedAcceptance = useRef(false);

  const load = useCallback(async () => {
    if (!token) {
      setLoaded(true);
      setError('This invitation is unavailable.');
      return;
    }
    try {
      setInvite(await publicTeamInvitesApi.get(token));
      setError(null);
    } catch {
      setError('This invitation is unavailable.');
    } finally {
      setLoaded(true);
    }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (status === 'authenticated' && shouldBypassOwnerOnboarding(role)) {
      preferences.completeOnboarding();
      setJoined(true);
    }
  }, [preferences, role, status]);
  const accept = async () => {
    if (!token || accepting) return;
    setAccepting(true);
    setError(null);
    try {
      const result = await publicTeamInvitesApi.accept(token);
      if (result.state === 'accepted') {
        await restore();
        await refreshPlan();
      } else if (result.state === 'expired') setInvite({ state: 'expired' });
      else if (result.state === 'already-used') setInvite({ state: 'accepted' });
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.kind === 'conflict'
          ? teamErrorCopy(caught.code, caught.message)
          : caught instanceof ApiError && caught.kind === 'not-found'
            ? 'This invitation was sent to a different email address or is no longer available.'
            : 'Couldn’t accept this invitation. Please try again.',
      );
    } finally {
      setAccepting(false);
    }
  };
  useEffect(() => {
    if (status === 'authenticated' && invite?.state === 'open' && !shouldBypassOwnerOnboarding(role) && !attemptedAcceptance.current) {
      attemptedAcceptance.current = true;
      void accept();
    }
  }, [invite?.state, role, status]);
  const openApp = () => {
    preferences.completeOnboarding();
    navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
  };

  if (!loaded) {
    return (
      <Screen>
        <M3Loading label="Loading invitation…" />
      </Screen>
    );
  }
  if (error && !invite) {
    return (
      <Screen>
        <M3Error message={error} onRetry={() => void load()} />
      </Screen>
    );
  }
  if (!invite) {
    return (
      <Screen>
        <M3Error message="This invitation is unavailable." onRetry={() => void load()} />
      </Screen>
    );
  }
  if (joined) {
    return (
      <Screen>
        <InviteHeader title="You joined the team" subtitle="Your Chakusa workspace is ready." />
        <PrimaryButton fullWidth label="Open Chakusa" onPress={openApp} />
      </Screen>
    );
  }
  if (invite.state !== 'open') {
    return (
      <Screen>
        <InviteHeader
          title={publicInviteStateCopy(invite.state)}
          subtitle="Ask the Business owner for a new invitation if you still need access."
        />
        {status === 'authenticated' && shouldBypassOwnerOnboarding(role) ? (
          <PrimaryButton fullWidth label="Open Chakusa" onPress={openApp} />
        ) : null}
      </Screen>
    );
  }
  return (
    <Screen>
      <InviteHeader
        title={`Join ${invite.business?.name ?? 'this Chakusa Business'}`}
        subtitle="You’ve been invited to work with this team in Chakusa."
      />
      <M3Card style={styles.card}>
        <View style={styles.cardTop}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{inviteInitial(invite.email)}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.email}>{invite.email}</Text>
            {invite.role ? <Chip label={roleLabel(invite.role)} tone={invite.role === 'ADMIN' ? 'secondary' : 'neutral'} /> : null}
          </View>
        </View>
        <Text style={styles.body}>
          {invite.role === 'ADMIN'
            ? 'Admins help with daily business operations.'
            : 'Staff work with customers, leads, reviews, and daily tasks.'}
        </Text>
      </M3Card>
      {status === 'authenticated' ? (
        <>
          <PrimaryButton
            fullWidth
            disabled={accepting}
            label={accepting ? 'Joining team…' : 'Accept invitation'}
            onPress={() => void accept()}
          />
          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}
        </>
      ) : (
        <View style={styles.auth}>
          <View style={styles.authHeadingRow}>
            <Icon name="lock" size={16} color={m3.onSurfaceVariant} />
            <Text style={styles.heading}>Sign in or create an account</Text>
          </View>
          <Text style={styles.body}>
            Use {invite.email ?? 'the invited email address'} so Chakusa can verify this invitation.
          </Text>
          <AuthForm invitationToken={token} invitedEmail={invite.email} defaultMode="register" onSuccess={() => undefined} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  headerBlock: { gap: 4, marginBottom: m3Space.md },
  eyebrow: { ...m3Type.labelSm, color: m3.primary, letterSpacing: 1 },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodyMd, color: m3.onSurfaceVariant },

  card: { gap: m3Space.sm, marginBottom: m3Space.md },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: m3Radius.full,
    backgroundColor: m3.surfaceContainerHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...m3Type.titleMd, color: m3.primary },
  email: { ...m3Type.labelLg, color: m3.onSurface, marginBottom: 4 },
  body: { ...m3Type.bodyMd, color: m3.onSurfaceVariant },

  auth: { gap: m3Space.sm },
  authHeadingRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heading: { ...m3Type.titleMd, color: m3.onSurface },
  error: { ...m3Type.bodySm, color: m3.error },
});
