import { BusinessRole, MembershipStatus, SubscriptionPlan, SubscriptionStatusValue, TeamInvitationStatus, TeamMemberDto, TeamSeatSummaryDto } from '../apiTypes';

export function teamAvailable(plan: SubscriptionPlan | null, status: SubscriptionStatusValue | null, feature: boolean | null) { return plan === 'BUSINESS' && ['ACTIVE','TRIALING','GRACE_PERIOD'].includes(status ?? '') && feature === true; }
export function canMutateTeam(role: string | null, available: boolean) { return role === 'OWNER' && available; }
export function roleLabel(role: BusinessRole) { return ({ OWNER: 'Owner', ADMIN: 'Admin', STAFF: 'Staff' } as const)[role]; }
export function membershipLabel(status: MembershipStatus) { return status === 'ACTIVE' ? 'Active' : 'Suspended'; }
export function ownerRowImmutable(member: Pick<TeamMemberDto, 'role'>) { return member.role === 'OWNER'; }
export function invitePayload(email: string, role: 'ADMIN'|'STAFF') { return { email: email.trim().toLowerCase(), role }; }
export function isValidInviteEmail(email: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()); }
export function invitationStatusLabel(status: TeamInvitationStatus) { return ({ PENDING: 'Pending', ACCEPTED: 'Accepted', EXPIRED: 'Expired', REVOKED: 'Revoked' } as const)[status]; }
export function publicInviteStateCopy(state: 'open'|'accepted'|'expired'|'revoked'|'invalid') { return ({ open: 'Invitation ready', accepted: 'Invitation already accepted', expired: 'Invitation expired', revoked: 'Invitation revoked', invalid: 'This invitation is unavailable.' } as const)[state]; }
export function seatUsageCopy({ current, limit }: TeamSeatSummaryDto['seats']) { return `${current} of ${limit} seats used`; }
export function seatDetailCopy({ activeMembers, pendingReservations }: TeamSeatSummaryDto['seats']) { return `${activeMembers} active ${activeMembers === 1 ? 'member' : 'members'} · ${pendingReservations} pending ${pendingReservations === 1 ? 'invitation' : 'invitations'}${pendingReservations > 0 ? ' (reserve seats)' : ''}`; }
export function remainingSeatCopy({ remaining }: TeamSeatSummaryDto['seats']) { return remaining === 0 ? 'All seats are currently in use.' : `${remaining} ${remaining === 1 ? 'seat' : 'seats'} remaining.`; }
export function inviteResultCopy(email: string, emailSent: boolean) { return emailSent ? `Invitation sent to ${email}.` : 'Invitation created, but the email could not be sent.'; }
export function inviteNeedsManualDelivery(emailSent: boolean) { return !emailSent; }
export function shouldReactivate(member: TeamMemberDto, ownerCanMutate: boolean) { return ownerCanMutate && member.role !== 'OWNER' && member.status === 'SUSPENDED'; }
export function teamDataVisible(available: boolean) { void available; return true; }
export function removeMemberCopy() { return 'Remove from team'; }
export function teamErrorCopy(code?: string, message?: string) {
  if (code === 'LIMIT_REACHED') return 'There are no available team seats on the current plan.';
  if (code === 'CONFLICT' && /already belong/i.test(message ?? '')) return 'Your Chakusa account is already connected to a business.';
  return 'The team could not be updated. Please refresh and try again.';
}
export function ownerDeletionError(code?: string) { return code === 'CONFLICT' ? 'Remove active team members before deleting this account.' : null; }
export function registrationInput(input: { email: string; password: string; fullName: string; businessName?: string; industry?: string }, invitationToken?: string) { return invitationToken ? { email: input.email, password: input.password, fullName: input.fullName, invitationToken } : input; }
export function shouldBypassOwnerOnboarding(role: string | null) { return role === 'ADMIN' || role === 'STAFF'; }
export function teamRoleCanSeeOwnerSettings(role: string | null) { return role === 'OWNER'; }
export function inheritedPaidFeatureAvailable(feature: boolean) { return feature; }
export function usageLimitLabel(limit: number | null) { return limit === null ? 'Unlimited' : String(limit); }
