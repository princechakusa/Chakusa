import { AttentionCategory, AttentionPageDto, AuthResponse, AutomationRuleDto, AutomationRunHistoryDto, BulkImportCustomersResultDto, BusinessDto, CreatedTeamInvitationDto, CustomerDto, CustomerListResponse, CustomerProfileDto, DashboardSummaryDto, FeedbackDto, LeadDto, LeadListResponse, LeadPaymentStatus, LeadStatus, MeResponse, MessageTemplateDto, PublicTeamInvitationDto, ReminderDto, ReviewRequestDto, SubscriptionStatusDto, TeamInvitationDto, TeamMemberDto, TeamSeatSummaryDto } from '../apiTypes';
import { api } from './api';
import { AppleChallenge, AppleCredentialPayload } from './appleAuth';

const query = (values: Record<string, string | number | undefined>) => { const params = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); }); const encoded = params.toString(); return encoded ? `?${encoded}` : ''; };

export const authApi = {
  register: (body: { email: string; password: string; fullName: string; businessName?: string; industry?: string; invitationToken?: string }) => api.post<AuthResponse>('/auth/register', body, 'none'),
  login: (body: { email: string; password: string }) => api.post<AuthResponse>('/auth/login', body, 'none'),
  google: (idToken: string, invitationToken?: string) => api.post<AuthResponse>('/auth/google', { idToken, invitationToken }, 'none'),
  linkGoogle: (idToken: string) => api.post<{ provider: 'GOOGLE'; providerEmail: string; linkedAt: string }>('/auth/google/link', { idToken }),
  appleChallenge: () => api.post<AppleChallenge>('/auth/apple/challenge', {}, 'none'),
  apple: (body: AppleCredentialPayload & { invitationToken?: string }) => api.post<AuthResponse>('/auth/apple', body, 'none'),
  appleLinkChallenge: () => api.post<AppleChallenge>('/auth/apple/link/challenge', {}),
  linkApple: (body: AppleCredentialPayload) => api.post<{ provider: 'APPLE'; providerEmail: string; linkedAt: string }>('/auth/apple/link', body),
  appleDeleteChallenge: () => api.post<AppleChallenge>('/auth/apple/delete/challenge', {}),
  logout: (refreshToken: string) => api.post<void>('/auth/logout', { refreshToken }, 'none'),
  logoutAll: () => api.post<void>('/auth/logout-all'),
  forgotPassword: (email: string) => api.post<{ message: string }>('/auth/forgot-password', { email }, 'none'),
  resetPassword: (token: string, password: string) => api.post<{ message: string }>('/auth/reset-password', { token, password }, 'none'),
  deleteAccount: (password: string) => api.post<void>('/auth/delete-account', { password }),
  deleteAccountWithGoogle: (googleIdToken: string) => api.post<void>('/auth/delete-account', { googleIdToken }),
  deleteAccountWithApple: (apple: AppleCredentialPayload) => api.post<void>('/auth/delete-account', { apple }),
  me: () => api.get<MeResponse>('/auth/me'),
};
export const businessApi = {
  create: (body: { name: string; industry?: string; phone?: string }) => api.post<BusinessDto>('/business', body),
  get: () => api.get<BusinessDto>('/business'),
  patch: (body: Partial<Pick<BusinessDto, 'name' | 'industry' | 'country' | 'phone' | 'googleReviewLink' | 'workingHours' | 'defaultServices' | 'reminderDays' | 'preferredTone'>>) => api.patch<BusinessDto>('/business', body),
};
export const devicesApi = {
  register: (body: { token: string; platform: 'ios' | 'android' | 'web' }) => api.post<{ id: string; platform: string; provider: string; isActive: boolean; lastUsedAt: string; createdAt: string }>('/devices', body),
  remove: (token: string) => api.delete<void>(`/devices/${encodeURIComponent(token)}`),
};
export const dashboardApi = { summary: () => api.get<DashboardSummaryDto>('/dashboard/summary'), attention: (category?: AttentionCategory, page = 1, pageSize = 25) => api.get<AttentionPageDto>(`/dashboard/attention${query({ category, page, pageSize })}`) };
export const customersApi = {
  list: (search = '', page = 1, pageSize = 100) => api.get<CustomerListResponse>(`/customers${query({ search, page, pageSize })}`),
  create: (body: { name: string; phone?: string; email?: string; notes?: string }) => api.post<CustomerDto>('/customers', body),
  get: (id: string) => api.get<CustomerProfileDto>(`/customers/${id}`),
  patch: (id: string, body: Partial<Pick<CustomerDto, 'name' | 'phone' | 'email' | 'notes'>>) => api.patch<CustomerDto>(`/customers/${id}`, body),
  bulkImport: (customers: { name: string; phone?: string; email?: string; notes?: string }[]) => api.post<BulkImportCustomersResultDto>('/customers/bulk-import', { customers }),
};
export const leadsApi = {
  list: (status?: LeadStatus, page = 1, pageSize = 100) => api.get<LeadListResponse>(`/leads${query({ status, page, pageSize })}`),
  create: (body: { customerId?: string; source?: string; missedCallTime?: string; serviceRequested?: string; urgency?: 'low' | 'medium' | 'high'; estimatedValue?: number; notes?: string }) => api.post<LeadDto>('/leads', body),
  get: (id: string) => api.get<LeadDto>(`/leads/${id}`), patch: (id: string, body: Partial<Pick<LeadDto, 'customerId' | 'source' | 'serviceRequested' | 'urgency' | 'estimatedValue' | 'notes' | 'status'>>) => api.patch<LeadDto>(`/leads/${id}`, body),
  generateMessage: (id: string) => api.post<{ message: string }>(`/leads/${id}/generate-message`),
  transition: (id: string, status: Exclude<LeadStatus, 'new'>) => api.post<LeadDto>(`/leads/${id}/mark-${status}`),
  updatePayment: (id: string, body: { paymentStatus: LeadPaymentStatus; paidAmount?: number }) => api.patch<LeadDto>(`/leads/${id}/payment`, body),
};
export const reviewsApi = {
  list: () => api.get<ReviewRequestDto[]>('/review-requests'), create: (body: { customerId?: string; serviceName?: string; message?: string }) => api.post<ReviewRequestDto>('/review-requests', body),
  get: (id: string) => api.get<ReviewRequestDto>(`/review-requests/${id}`), patch: (id: string, body: Partial<Pick<ReviewRequestDto, 'serviceName' | 'message' | 'status'>>) => api.patch<ReviewRequestDto>(`/review-requests/${id}`, body),
  generateMessage: (id: string) => api.post<{ message: string }>(`/review-requests/${id}/generate-message`), markOpened: (id: string) => api.post<ReviewRequestDto>(`/review-requests/${id}/mark-opened`), markSent: (id: string) => api.post<ReviewRequestDto>(`/review-requests/${id}/mark-sent`), markReviewed: (id: string) => api.post<ReviewRequestDto>(`/review-requests/${id}/mark-reviewed`), markFeedbackReceived: (id: string) => api.post<ReviewRequestDto>(`/review-requests/${id}/mark-feedback-received`),
  bulkCreate: () => api.post<{ created: { id: string; customerName: string; message: string }[]; skipped: { customerName: string; reason: string }[] }>('/review-requests/bulk-create'),
  bulkSend: () => api.post<{ sentCount: number; failedCount: number; skippedCount: number; results: { id: string; customerName: string; outcome: 'sent' | 'failed'; reason?: string }[] }>('/review-requests/bulk-send'),
};
export const feedbackApi = { list: () => api.get<FeedbackDto[]>('/feedback'), create: (body: { customerId?: string; reviewRequestId?: string; rating: number; comment?: string }) => api.post<FeedbackDto>('/feedback', body) };
export const remindersApi = {
  list: () => api.get<ReminderDto[]>('/reminders'), create: (body: { customerId?: string; serviceName?: string; lastVisitDate?: string; dueDate?: string }) => api.post<ReminderDto>('/reminders', body), get: (id: string) => api.get<ReminderDto>(`/reminders/${id}`), patch: (id: string, body: Partial<Pick<ReminderDto, 'serviceName' | 'lastVisitDate' | 'dueDate' | 'status'>>) => api.patch<ReminderDto>(`/reminders/${id}`, body), generateMessage: (id: string) => api.post<{ message: string }>(`/reminders/${id}/generate-message`), markSent: (id: string) => api.post<ReminderDto>(`/reminders/${id}/mark-sent`), markCompleted: (id: string) => api.post<ReminderDto>(`/reminders/${id}/mark-completed`), dismiss: (id: string) => api.post<ReminderDto>(`/reminders/${id}/dismiss`),
  bulkGenerateMessages: () => api.post<{ id: string; customerName: string | null; message: string }[]>('/reminders/bulk-generate-messages'),
  bulkSend: () => api.post<{ sentCount: number; failedCount: number; skippedCount: number; results: { id: string; customerName: string | null; outcome: 'sent' | 'failed' | 'skipped'; reason?: string }[] }>('/reminders/bulk-send'),
};
export const templatesApi = { list: () => api.get<MessageTemplateDto[]>('/message-templates'), create: (body: { templateType: MessageTemplateDto['templateType']; name: string; body: string; tone?: MessageTemplateDto['tone']; isDefault?: boolean }) => api.post<MessageTemplateDto>('/message-templates', body), patch: (id: string, body: Partial<Pick<MessageTemplateDto, 'templateType' | 'name' | 'body' | 'tone' | 'isDefault'>>) => api.patch<MessageTemplateDto>(`/message-templates/${id}`, body) };
export const subscriptionApi = {
  getStatus: () => api.get<SubscriptionStatusDto>('/subscription/status'),
  verifyApple: (transactionId: string) => api.post<SubscriptionStatusDto>('/subscription/apple/verify', { transactionId }),
  verifyGoogle: (purchaseToken: string) => api.post<SubscriptionStatusDto>('/subscription/google/verify', { purchaseToken }),
};
export const automationApi = {
  listRules: () => api.get<AutomationRuleDto[]>('/automation/rules'),
  listRuns: (page = 1, pageSize = 25) => api.get<AutomationRunHistoryDto>(`/automation/runs${query({ page, pageSize })}`),
  createRule: (body: { name: string; enabled: boolean; triggerType: 'LEAD_CREATED'; channel: 'SMS'; delaySeconds: number; config: Record<string, unknown> }) => api.post<AutomationRuleDto>('/automation/rules', body),
  updateRule: (id: string, body: { delaySeconds: number }) => api.patch<AutomationRuleDto>(`/automation/rules/${id}`, body),
  enableRule: (id: string) => api.post<AutomationRuleDto>(`/automation/rules/${id}/enable`),
  disableRule: (id: string) => api.post<AutomationRuleDto>(`/automation/rules/${id}/disable`),
};
export const missedCallsApi = {
  report: (body: { phone: string; occurredAt: string; clientEventId: string }) => api.post<LeadDto>('/leads/missed-call', body),
};
export const teamApi = {
  getSummary: () => api.get<TeamSeatSummaryDto>('/team/summary'),
  listMembers: () => api.get<TeamMemberDto[]>('/team/members'),
  listInvitations: () => api.get<TeamInvitationDto[]>('/team/invitations'),
  invite: (body: { email: string; role: 'ADMIN' | 'STAFF' }) => api.post<CreatedTeamInvitationDto>('/team/invitations', body),
  revokeInvitation: (id: string) => api.delete<TeamInvitationDto>(`/team/invitations/${id}`),
  changeRole: (id: string, role: 'ADMIN' | 'STAFF') => api.patch<TeamMemberDto>(`/team/members/${id}`, { role }),
  removeMember: (id: string) => api.delete<TeamMemberDto>(`/team/members/${id}`),
  reactivateMember: (id: string) => api.post<TeamMemberDto>(`/team/members/${id}/reactivate`),
};
export const publicTeamInvitesApi = {
  get: (token: string) => api.get<PublicTeamInvitationDto>(`/public/team-invites/${encodeURIComponent(token)}`, 'none'),
  accept: (token: string) => api.post<{ state: 'accepted' | 'expired' | 'already-used' }>(`/public/team-invites/${encodeURIComponent(token)}/accept`),
};
