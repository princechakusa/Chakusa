import * as Clipboard from 'expo-clipboard';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { TeamInvitationDto, TeamMemberDto, TeamSeatSummaryDto } from '../apiTypes';
import { PUBLIC_WEB_ORIGIN } from '../domain/trustSettings';
import { PrimaryButton, SecondaryButton } from '../components/ui';
import {
  canMutateTeam,
  invitationStatusLabel,
  inviteNeedsManualDelivery,
  invitePayload,
  inviteResultCopy,
  isValidInviteEmail,
  membershipLabel,
  remainingSeatCopy,
  roleLabel,
  seatDetailCopy,
  seatUsageCopy,
  shouldReactivate,
  teamAvailable,
  teamErrorCopy,
} from '../domain/team';
import { ApiError } from '../services/api';
import { teamApi } from '../services/endpoints';
import { useAuth } from '../state/AuthContext';
import { usePlanExperience } from '../state/PlanExperienceContext';
import { colors, radius, spacing, typography } from '../theme';
import { m3, m3Radius, m3Space, m3Type } from '../experience/businessTheme';
import { Chip, Icon, M3Card, M3Error, M3Header, M3Loading, M3Screen } from '../experience/businessKit';
import { RootStackParamList } from '../types';
import { formatDate } from '../utils/format';

type Props = NativeStackScreenProps<RootStackParamList, 'Team'>;

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function TeamScreen({ navigation }: Props) {
  const { role, business, restore } = useAuth();
  const { plan, status, features } = usePlanExperience();
  const [members, setMembers] = useState<TeamMemberDto[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitationDto[]>([]);
  const [summary, setSummary] = useState<TeamSeatSummaryDto['seats'] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const [mutation, setMutation] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'STAFF'>('STAFF');
  const [inviteResult, setInviteResult] = useState<{ email: string; emailSent: boolean; link: string } | null>(null);
  const [transferTarget, setTransferTarget] = useState<TeamMemberDto | null>(null);
  const [transferConfirmation, setTransferConfirmation] = useState('');
  const loadingRef = useRef<Promise<void> | null>(null);

  const available = teamAvailable(plan, status, features?.teamManagement ?? null);
  const canManage = canMutateTeam(role, available);
  const owner = role === 'OWNER';

  const load = useCallback(async () => {
    if (loadingRef.current) return loadingRef.current;
    const request = (async () => {
      const [teamResult, summaryResult] = await Promise.allSettled([
        Promise.all([teamApi.listMembers(), owner ? teamApi.listInvitations() : Promise.resolve([])]),
        teamApi.getSummary(),
      ]);
      if (teamResult.status === 'fulfilled') {
        setMembers(teamResult.value[0]);
        setInvitations(teamResult.value[1]);
        setError(null);
      } else {
        setError('Could not load your team. Check your connection and try again.');
      }
      if (summaryResult.status === 'fulfilled') {
        setSummary(summaryResult.value.seats);
        setSummaryError(false);
      } else {
        setSummaryError(true);
      }
      setLoaded(true);
    })();
    loadingRef.current = request;
    try {
      await request;
    } finally {
      loadingRef.current = null;
    }
  }, [owner]);

  useFocusEffect(useCallback(() => { void load(); return () => setInviteResult(null); }, [load]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void load();
    });
    return () => subscription.remove();
  }, [load]);

  const refresh = () => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  };
  const mutate = async (key: string, action: () => Promise<unknown>) => {
    if (mutation) return;
    setMutation(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? teamErrorCopy(caught.code, caught.message) : teamErrorCopy());
    } finally {
      setMutation(null);
    }
  };
  const submitInvite = async () => {
    if (!isValidInviteEmail(email) || mutation) return;
    setMutation('invite');
    setError(null);
    try {
      const created = await teamApi.invite(invitePayload(email, inviteRole));
      setInviteResult({
        email: created.email,
        emailSent: created.emailSent,
        link: `${PUBLIC_WEB_ORIGIN}/team-invite/${encodeURIComponent(created.token)}`,
      });
      setEmail('');
      setInviteOpen(false);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? teamErrorCopy(caught.code, caught.message) : teamErrorCopy());
    } finally {
      setMutation(null);
    }
  };
  const remove = (member: TeamMemberDto) =>
    Alert.alert(
      'Remove from team?',
      `This removes ${member.name}'s access to this Business. It does not delete their Chakusa account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove from team', style: 'destructive', onPress: () => void mutate(`remove-${member.id}`, () => teamApi.removeMember(member.id)) },
      ],
    );
  const revoke = (invite: TeamInvitationDto) =>
    Alert.alert('Revoke invitation?', `${invite.invitedEmail} will no longer be able to use this invitation.`, [
      { text: 'Keep invitation', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: () => void mutate(`revoke-${invite.id}`, () => teamApi.revokeInvitation(invite.id)) },
    ]);
  const transfer = async () => {
    if (!transferTarget || transferConfirmation.trim() !== business?.name.trim() || mutation) return;
    setMutation('transfer');
    setError(null);
    try {
      const nextOwner = transferTarget.name;
      await teamApi.transferOwnership(transferTarget.id, transferConfirmation);
      setTransferTarget(null);
      setTransferConfirmation('');
      await restore();
      await load();
      Alert.alert('Ownership transferred', `${nextOwner} is now the owner. You remain an administrator.`);
    } catch (caught) {
      setError(caught instanceof ApiError ? teamErrorCopy(caught.code, caught.message) : teamErrorCopy());
    } finally {
      setMutation(null);
    }
  };

  const pending = invitations.filter((item) => item.status === 'PENDING');
  const activeSeats = members.filter((m) => m.status === 'ACTIVE').length;

  const header = (
    <M3Header
      businessName="More" onBack={() => navigation.goBack()}
      onNotificationsPress={() => navigation.navigate('AttentionCenter')}
      onAvatarPress={() => navigation.navigate('Main', { screen: 'Settings' })}
      hasNotifications={pending.length > 0}
    />
  );

  return (
    <>
      <M3Screen header={header} refreshControl={undefined}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <Text style={styles.title}>Team Roles & Permissions</Text>
            <Text style={styles.subtitle}>Owner, Admin and Staff access across this studio.</Text>
          </View>
          {canManage ? (
            <Pressable accessibilityRole="button" onPress={() => setInviteOpen(true)} style={styles.inviteBtn}>
              <Icon name="person_add" size={17} color={m3.onPrimary} />
              <Text style={styles.inviteText}>Invite</Text>
            </Pressable>
          ) : null}
        </View>

        {!available ? (
          <M3Card style={styles.lockedCard}>
            <Text style={styles.lockedTitle}>Team access is unavailable on your current plan</Text>
            <Text style={styles.lockedBody}>
              Existing team records are preserved. Upgrade to Chakusa Business to invite or manage team members.
            </Text>
            {owner ? (
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Pro')} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>View Business</Text>
              </Pressable>
            ) : null}
          </M3Card>
        ) : null}

        {!loaded ? (
          <M3Loading label="Loading team…" />
        ) : error && !members.length ? (
          <M3Error message={error} onRetry={() => void load()} />
        ) : (
          <>
            <M3Card style={styles.seatCard}>
              <View style={styles.seatTop}>
                <Text style={styles.seatHeading}>Seats</Text>
                <Chip label={`${activeSeats} active`} tone="secondary" />
              </View>
              {summary ? (
                <>
                  <Text style={styles.seatUsage}>{seatUsageCopy(summary)}</Text>
                  <Text style={styles.caption}>{seatDetailCopy(summary)}</Text>
                  <Text style={styles.caption}>{remainingSeatCopy(summary)}</Text>
                  {summaryError ? <Text style={styles.errorText}>Could not refresh seats. Last known values shown.</Text> : null}
                </>
              ) : (
                <M3Error message="Could not load seat information. Your team is still available." onRetry={() => void load()} />
              )}
            </M3Card>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>ACTIVE STAFF & TIER ASSIGNMENTS</Text>
              {members.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  canManage={canManage}
                  busy={Boolean(mutation)}
                  onRole={() => void mutate(`role-${member.id}`, () => teamApi.changeRole(member.id, member.role === 'ADMIN' ? 'STAFF' : 'ADMIN'))}
                  onRemove={() => remove(member)}
                  onReactivate={() => void mutate(`reactivate-${member.id}`, () => teamApi.reactivateMember(member.id))}
                  onTransfer={() => {
                    setTransferTarget(member);
                    setTransferConfirmation('');
                  }}
                />
              ))}
            </View>

            {owner ? (
              <View style={styles.section}>
                <View style={styles.sectionHeadRow}>
                  <Text style={styles.sectionTitle}>PENDING INVITATIONS</Text>
                  {canManage ? (
                    <Pressable accessibilityRole="button" onPress={() => setInviteOpen(true)}>
                      <Text style={styles.inlineAction}>Invite member</Text>
                    </Pressable>
                  ) : null}
                </View>
                {pending.length ? (
                  pending.map((item) => (
                    <M3Card key={item.id} style={styles.inviteCard}>
                      <View style={styles.flex}>
                        <Text style={styles.inviteEmail}>{item.invitedEmail}</Text>
                        <Text style={styles.caption}>
                          {roleLabel(item.role)} · Expires {formatDate(item.expiresAt)}
                        </Text>
                        <Text style={styles.caption}>{invitationStatusLabel(item.status)}</Text>
                      </View>
                      {canManage ? (
                        <Pressable accessibilityRole="button" disabled={Boolean(mutation)} onPress={() => revoke(item)} style={styles.ghostBtn}>
                          <Text style={styles.ghostBtnText}>Revoke</Text>
                        </Pressable>
                      ) : null}
                    </M3Card>
                  ))
                ) : (
                  <Text style={styles.body}>No pending invitations.</Text>
                )}
              </View>
            ) : null}
          </>
        )}

        {inviteResult ? (
          <M3Card style={styles.manualCard}>
            <Text style={styles.seatHeading}>Invitation created</Text>
            <Text style={styles.body}>{inviteResultCopy(inviteResult.email, inviteResult.emailSent)}</Text>
            {inviteNeedsManualDelivery(inviteResult.emailSent) ? (
              <Text style={styles.body}>Copy this link and send it to the team member to complete delivery manually.</Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => void Clipboard.setStringAsync(inviteResult.link).then(() => setInviteResult(null))}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnText}>Copy invitation link</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setInviteResult(null)} style={styles.ghostWide}>
              <Text style={styles.ghostBtnText}>Dismiss</Text>
            </Pressable>
          </M3Card>
        ) : null}

        {error && members.length ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {error} Existing team information is still shown.
          </Text>
        ) : null}
      </M3Screen>

      <Modal visible={inviteOpen} transparent animationType="fade" onRequestClose={() => setInviteOpen(false)}>
        <View style={styles.overlay}>
          <View accessibilityViewIsModal style={styles.dialog}>
            <Text style={styles.dialogTitle}>Invite team member</Text>
            <Text style={styles.label}>Email</Text>
            <TextInput
              accessibilityLabel="Team member email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              style={styles.dialogInput}
            />
            <Text style={styles.label}>Role</Text>
            <View accessibilityRole="radiogroup" style={styles.roles}>
              <RoleChoice role="ADMIN" selected={inviteRole === 'ADMIN'} onPress={() => setInviteRole('ADMIN')} copy="Helps manage daily business operations." />
              <RoleChoice role="STAFF" selected={inviteRole === 'STAFF'} onPress={() => setInviteRole('STAFF')} copy="Works with customers, leads, reviews, and daily tasks." />
            </View>
            <PrimaryButton
              fullWidth
              disabled={!isValidInviteEmail(email) || Boolean(mutation)}
              label={mutation === 'invite' ? 'Sending invitation…' : 'Send invitation'}
              onPress={() => void submitInvite()}
            />
            <SecondaryButton fullWidth disabled={Boolean(mutation)} label="Cancel" onPress={() => setInviteOpen(false)} />
          </View>
        </View>
      </Modal>

      <Modal visible={Boolean(transferTarget)} transparent animationType="fade" onRequestClose={() => setTransferTarget(null)}>
        <View style={styles.overlay}>
          <View accessibilityViewIsModal style={styles.dialog}>
            <Text style={styles.dialogTitle}>Transfer business ownership</Text>
            <Text style={styles.body}>
              {transferTarget?.name} will control billing, team access, and account deletion. You will become an
              administrator.
            </Text>
            <Text style={styles.label}>Type {business?.name} to confirm</Text>
            <TextInput
              accessibilityLabel="Business name confirmation"
              autoCapitalize="none"
              value={transferConfirmation}
              onChangeText={setTransferConfirmation}
              style={styles.dialogInput}
            />
            <PrimaryButton
              fullWidth
              disabled={transferConfirmation.trim() !== business?.name.trim() || Boolean(mutation)}
              label={mutation === 'transfer' ? 'Transferring ownership…' : 'Transfer ownership'}
              onPress={() => void transfer()}
            />
            <SecondaryButton fullWidth disabled={Boolean(mutation)} label="Cancel" onPress={() => setTransferTarget(null)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

function MemberCard({
  member,
  canManage,
  busy,
  onRole,
  onRemove,
  onReactivate,
  onTransfer,
}: {
  member: TeamMemberDto;
  canManage: boolean;
  busy: boolean;
  onRole: () => void;
  onRemove: () => void;
  onReactivate: () => void;
  onTransfer: () => void;
}) {
  const mutable = canManage && member.role !== 'OWNER';
  const roleTone = member.role === 'OWNER' ? 'primaryFixed' : member.role === 'ADMIN' ? 'secondary' : 'neutral';
  return (
    <M3Card style={[styles.memberCard, member.status === 'SUSPENDED' && styles.suspended]}>
      <View style={styles.memberTop}>
        <View style={styles.memberIdentity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(member.name)}</Text>
          </View>
          <View style={styles.flex}>
            <Text numberOfLines={1} style={styles.memberName}>
              {member.name}
            </Text>
            <Text numberOfLines={1} style={styles.memberEmail}>
              {member.email}
            </Text>
          </View>
        </View>
        <Chip label={roleLabel(member.role)} tone={roleTone} />
      </View>
      <Text style={styles.memberMeta}>
        {membershipLabel(member.status)} · Joined {formatDate(member.joinedAt)}
      </Text>
      {mutable ? (
        <View style={styles.memberActions}>
          {member.status === 'ACTIVE' ? (
            <>
              <Pressable accessibilityRole="button" disabled={busy} onPress={onRole} style={styles.ghostBtn}>
                <Text style={styles.ghostBtnText}>Make {member.role === 'ADMIN' ? 'Staff' : 'Admin'}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={onTransfer} style={styles.ghostBtn}>
                <Text style={styles.ghostBtnText}>Transfer ownership</Text>
              </Pressable>
              <Pressable accessibilityRole="button" disabled={busy} onPress={onRemove} style={styles.ghostBtn}>
                <Text style={styles.ghostBtnText}>Remove</Text>
              </Pressable>
            </>
          ) : shouldReactivate(member, canManage) ? (
            <Pressable accessibilityRole="button" disabled={busy} onPress={onReactivate} style={styles.ghostBtn}>
              <Text style={styles.ghostBtnText}>Reactivate</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </M3Card>
  );
}

function RoleChoice({ role, selected, copy, onPress }: { role: 'ADMIN' | 'STAFF'; selected: boolean; copy: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress} style={[styles.role, selected && styles.roleSelected]}>
      <Text style={styles.roleName}>{roleLabel(role)}</Text>
      <Text style={styles.caption}>{copy}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },

  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: m3Space.sm },
  title: { ...m3Type.headlineMd, color: m3.onSurface },
  subtitle: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 2 },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 36, paddingHorizontal: 12, borderRadius: m3Radius.sm, backgroundColor: m3.primary },
  inviteText: { ...m3Type.labelMd, color: m3.onPrimary },

  lockedCard: { gap: m3Space.sm, backgroundColor: 'rgba(255,218,211,0.4)' },
  lockedTitle: { ...m3Type.titleMd, color: m3.onSurface },
  lockedBody: { ...m3Type.bodySm, color: m3.onSurfaceVariant },

  seatCard: { gap: 4 },
  seatTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seatHeading: { ...m3Type.titleMd, color: m3.onSurface },
  seatUsage: { ...m3Type.headlineSm, color: m3.onSurface, marginTop: 2 },
  caption: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  body: { ...m3Type.bodyMd, color: m3.onSurfaceVariant },
  errorText: { ...m3Type.bodySm, color: m3.error },

  section: { gap: m3Space.xs },
  sectionTitle: { ...m3Type.labelSm, color: m3.onSurfaceVariant, letterSpacing: 0.6, paddingHorizontal: 2 },
  sectionHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inlineAction: { ...m3Type.labelMd, color: m3.primary },

  memberCard: { gap: m3Space.xs },
  suspended: { opacity: 0.7 },
  memberTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m3Space.xs },
  memberIdentity: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 },
  avatar: { width: 44, height: 44, borderRadius: m3Radius.full, backgroundColor: m3.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center' },
  avatarText: { ...m3Type.labelLg, color: m3.primary },
  memberName: { ...m3Type.headlineSm, fontSize: 16, color: m3.onSurface },
  memberEmail: { ...m3Type.bodySm, color: m3.onSurfaceVariant, marginTop: 1 },
  memberMeta: { ...m3Type.bodySm, color: m3.onSurfaceVariant },
  memberActions: { flexDirection: 'row', flexWrap: 'wrap', gap: m3Space.xs, marginTop: 4 },

  inviteCard: { flexDirection: 'row', alignItems: 'center', gap: m3Space.sm },
  inviteEmail: { ...m3Type.labelLg, color: m3.onSurface },

  ghostBtn: { height: 34, paddingHorizontal: 12, borderRadius: m3Radius.sm, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  ghostBtnText: { ...m3Type.labelMd, color: m3.onSurface },
  ghostWide: { height: 42, borderRadius: m3Radius.md, backgroundColor: m3.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { height: 46, borderRadius: m3Radius.md, backgroundColor: m3.primary, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { ...m3Type.labelLg, color: m3.onPrimary },

  manualCard: { gap: m3Space.sm, backgroundColor: 'rgba(171,45,25,0.06)' },

  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'center', padding: spacing.lg },
  dialog: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.xl, gap: spacing.md },
  dialogTitle: { ...typography.heading, color: colors.text },
  label: { ...typography.caption, color: colors.text },
  dialogInput: { minHeight: 50, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, ...typography.body, color: colors.text },
  roles: { gap: spacing.sm },
  role: { minHeight: 64, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  roleSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  roleName: { ...typography.bodyStrong, color: colors.text },
});
