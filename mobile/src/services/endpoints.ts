import { AttentionCategory, AttentionPageDto, AudienceCenterDto, AuthResponse, AutomationChannel, AutomationFoundationDto, AutomationRuleDto, AutomationRunHistoryDto, AutomationTriggerType, BetaFeedbackCategory, BetaFeedbackDto, BulkImportCustomersResultDto, BusinessCoachingDto, BusinessDto, BusinessInsightsDto, CalendarSubscriptionDto, CreatedTeamInvitationDto, CustomerDto, CustomerListResponse, CustomerProfileDto, DashboardSummaryDto, FeedbackDto, LeadDto, LeadListResponse, LeadPaymentStatus, LeadStatus, MeResponse, MessageTemplateDto, PublicTeamInvitationDto, ReminderDto, ReviewRequestDto, ServiceOfferingDto, SubscriptionStatusDto, SupportTicketCategory, SupportTicketDto, TeamInvitationDto, TeamMemberDto, TeamSeatSummaryDto, ValueCenterDto, WeeklyOwnerReportDto, WorkflowAnalyticsDto, WorkflowDto, WorkflowExecutionDto, WorkflowTemplateDto } from '../apiTypes';
import { api } from './api';
import type { AiConversationRunDto, AiValueCenterDto, AiHealthDto, AiEvaluationRunDto } from '../apiTypes';
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
  updateProfile: (fullName: string) => api.patch<{ id: string; email: string; fullName: string }>('/auth/profile', { fullName }),
  changePassword: (body: { currentPassword?: string; newPassword: string }) => api.post<void>('/auth/change-password', body),
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
  patch: (body: Partial<Pick<BusinessDto, 'name' | 'industry' | 'country' | 'timezone' | 'currency' | 'phone' | 'description' | 'googleReviewLink' | 'workingHours' | 'defaultServices' | 'reminderDays' | 'preferredTone' | 'bookingMinNoticeMinutes' | 'bookingWindowDays' | 'slotIntervalMinutes' | 'cancellationNoticeMinutes' | 'defaultAppointmentReminderMinutes' | 'paymentRemindersEnabled'>> & { messagingConsentConfirmed?: boolean }) => api.patch<BusinessDto>('/business', body),
  completeOnboarding: () => api.post<BusinessDto>('/business/onboarding/complete'),
  exportData: () => api.get<Record<string, unknown>>('/business/export'),
};
export const calendarApi = {
  listSubscriptions: () => api.get<CalendarSubscriptionDto[]>('/calendar/subscriptions'),
  createSubscription: (label?: string) => api.post<CalendarSubscriptionDto & { token: string; feedUrl: string }>('/calendar/subscriptions', label ? { label } : {}),
  revokeSubscription: (id: string) => api.post<{ revoked: boolean }>(`/calendar/subscriptions/${id}/revoke`, {}),
};
export const devicesApi = {
  register: (body: { token: string; platform: 'ios' | 'android' | 'web' }) => api.post<{ id: string; platform: string; provider: string; isActive: boolean; lastUsedAt: string; createdAt: string }>('/devices', body),
  remove: (token: string) => api.delete<void>(`/devices/${encodeURIComponent(token)}`),
};
export const dashboardApi = { summary: () => api.get<DashboardSummaryDto>('/dashboard/summary'), attention: (category?: AttentionCategory, page = 1, pageSize = 25) => api.get<AttentionPageDto>(`/dashboard/attention${query({ category, page, pageSize })}`), insights: () => api.get<BusinessInsightsDto>('/dashboard/insights'), coaching: () => api.get<BusinessCoachingDto>('/dashboard/coaching'), value: () => api.get<ValueCenterDto>('/dashboard/value') };
export const weeklyReportsApi = { list: () => api.get<WeeklyOwnerReportDto[]>('/weekly-reports') };
export const supportApi = { list: () => api.get<SupportTicketDto[]>('/support-tickets'), create: (body: { category: SupportTicketCategory; subject: string; message: string }) => api.post<SupportTicketDto>('/support-tickets', body) };
export const betaFeedbackApi = { create: (body: { rating: number; category: BetaFeedbackCategory; title: string; description: string; platform?: 'Android' | 'iOS' | 'Web'; appVersion?: string; deviceModel?: string; buildNumber?: string }) => api.post<BetaFeedbackDto>('/support-tickets/feedback', body) };
export const paymentsApi = { connectStatus: () => api.get<{ connected: boolean; chargesEnabled: boolean; detailsSubmitted: boolean; payoutsEnabled: boolean }>('/payments/connect/status'), connectLink: () => api.post<{ url: string }>('/payments/connect/link', {}) };
export const customersApi = {
  list: (search = '', page = 1, pageSize = 100) => api.get<CustomerListResponse>(`/customers${query({ search, page, pageSize })}`),
  create: (body: { name: string; phone?: string; email?: string; notes?: string }) => api.post<CustomerDto>('/customers', body),
  get: (id: string) => api.get<CustomerProfileDto>(`/customers/${id}`),
  patch: (id: string, body: Partial<Pick<CustomerDto, 'name' | 'phone' | 'email' | 'notes'>>) => api.patch<CustomerDto>(`/customers/${id}`, body),
  bulkImport: (customers: { name: string; phone?: string; email?: string; notes?: string }[]) => api.post<BulkImportCustomersResultDto>('/customers/bulk-import', { customers }),
  audiences: () => api.get<AudienceCenterDto>('/customers/audiences'),
  createTag: (name: string) => api.post<{ id: string; name: string }>('/customers/tags', { name }),
  setTags: (customerId: string, tagIds: string[]) => api.patch(`/customers/${customerId}/tags`, { tagIds }),
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
export const appointmentsApi = {
  list: (from: string, to: string, customerId?: string) => api.get<import('../apiTypes').AppointmentDto[]>(`/appointments${query({ from, to, customerId })}`),
  get: (id: string) => api.get<import('../apiTypes').AppointmentDto>(`/appointments/${id}`),
  create: (body: { customerId?: string; assignedMemberId?: string; serviceOfferingId?: string; serviceName: string; startsAt: string; endsAt: string; price?: number; notes?: string; reminderMinutes?: number | null }) => api.post<import('../apiTypes').AppointmentDto>('/appointments', body),
  patch: (id: string, body: Partial<Pick<import('../apiTypes').AppointmentDto, 'customerId' | 'assignedMemberId' | 'serviceOfferingId' | 'serviceName' | 'startsAt' | 'endsAt' | 'price' | 'notes' | 'reminderMinutes'>>) => api.patch<import('../apiTypes').AppointmentDto>(`/appointments/${id}`, body),
  transition: (id: string, status: import('../apiTypes').AppointmentStatus) => api.post<import('../apiTypes').AppointmentDto>(`/appointments/${id}/status`, { status }),
  sendConfirmation: (id: string) => api.post<import('../apiTypes').AppointmentDto>(`/appointments/${id}/send-confirmation`, {}),
  updatePayment: (id: string, paidAmount: number) => api.patch<import('../apiTypes').AppointmentDto>(`/appointments/${id}/payment`, { paidAmount }),
  bulkImport: (appointments: import('../domain/appointmentsImport').AppointmentImportRow[]) => api.post<{ created: { id: string }[]; skipped: { reason: string }[]; failed: { reason: string }[] }>('/appointments/bulk-import', { appointments }),
};
export interface ServiceOfferingInput { name: string; description?: string | null; category?: string | null; durationMinutes: number; preparationMinutes?: number; cleanupMinutes?: number; price?: number | null; depositAmount?: number | null; active?: boolean; publiclyBookable?: boolean; sortOrder?: number; memberIds?: string[]; }
export const servicesApi = {
  list: (active?: boolean) => api.get<ServiceOfferingDto[]>(`/services${query({ active: active === undefined ? undefined : String(active) })}`),
  create: (body: ServiceOfferingInput) => api.post<ServiceOfferingDto>('/services', body),
  patch: (id: string, body: Partial<ServiceOfferingInput>) => api.patch<ServiceOfferingDto>(`/services/${id}`, body),
  archive: (id: string) => api.delete<ServiceOfferingDto>(`/services/${id}`),
};
export interface AvailabilitySlotDto { startsAt: string; endsAt: string; members: { id: string; name: string }[]; }
export interface BookingBlockDto { id: string; assignedMemberId: string | null; startsAt: string; endsAt: string; reason: string | null; }
export const availabilityApi = {
  list: (serviceOfferingId: string, from: string, to: string, memberId?: string) => api.get<AvailabilitySlotDto[]>(`/availability${query({ serviceOfferingId, from, to, memberId })}`),
  blocks: (from: string, to: string) => api.get<BookingBlockDto[]>(`/availability/blocks${query({ from, to })}`),
  createBlock: (body: { assignedMemberId?: string | null; startsAt: string; endsAt: string; reason?: string | null }) => api.post<BookingBlockDto>('/availability/blocks', body),
  deleteBlock: (id: string) => api.delete<void>(`/availability/blocks/${id}`),
};
export const templatesApi = { list: () => api.get<MessageTemplateDto[]>('/message-templates'), create: (body: { templateType: MessageTemplateDto['templateType']; name: string; body: string; tone?: MessageTemplateDto['tone']; isDefault?: boolean }) => api.post<MessageTemplateDto>('/message-templates', body), patch: (id: string, body: Partial<Pick<MessageTemplateDto, 'templateType' | 'name' | 'body' | 'tone' | 'isDefault'>>) => api.patch<MessageTemplateDto>(`/message-templates/${id}`, body) };
export const messagingApi = {
  conversations: () => api.get<Array<{id:string;status:string;priority:string;automationMode:string;assignedMemberId:string|null;updatedAt:string;messages:Array<{id:string;body:string;direction:string}>;slas:Array<{type:string;status:string;dueAt:string}>}>>('/messages/conversations?limit=50'),
  failures: () => api.get<Array<{id:string;status:string;lastError:string|null;message:{body:string}}>>('/messages/failures'),
  analytics: () => api.get<{conversations:Array<{status:string;_count:number}>;delivery:Array<{status:string;channel:string;_count:number}>;verifiedCost:string}>('/messages/analytics'),
  retry: (id: string) => api.post<{queued:boolean}>(`/messages/failures/${id}/retry`),
  templates: () => api.get<Array<{id:string;name:string;versions:Array<{id:string;status:string;locale:string;body:string}>}>>('/messages/templates'),
  updateConversation: (id:string, body:{status?:string;assignedMemberId?:string|null;automationMode?:string}) => api.patch(`/messages/conversations/${id}`,body),
  completeAnalytics: () => api.get<Record<string,unknown>>('/messages/analytics/complete'),
  uploadAttachment: (body: { fileName: string; mimeType: string; dataBase64: string }) => api.post<{ id: string; uploadStatus: string; malwareScanStatus: string }>('/messages/attachments/mobile', body),
};
export const subscriptionApi = {
  getStatus: () => api.get<SubscriptionStatusDto>('/subscription/status'),
  verifyApple: (transactionId: string) => api.post<SubscriptionStatusDto>('/subscription/apple/verify', { transactionId }),
  verifyGoogle: (purchaseToken: string) => api.post<SubscriptionStatusDto>('/subscription/google/verify', { purchaseToken }),
};
export const automationApi = {
  foundationStatus: () => api.get<AutomationFoundationDto>('/automation/foundation/status'),
  listRules: () => api.get<AutomationRuleDto[]>('/automation/rules'),
  listRuns: (page = 1, pageSize = 25) => api.get<AutomationRunHistoryDto>(`/automation/runs${query({ page, pageSize })}`),
  createRule: (body: { name: string; enabled: boolean; triggerType: AutomationTriggerType; channel: AutomationChannel; delaySeconds: number; config: Record<string, unknown> }) => api.post<AutomationRuleDto>('/automation/rules', body),
  updateRule: (id: string, body: { name?: string; channel?: AutomationChannel; delaySeconds?: number; config?: Record<string, unknown> }) => api.patch<AutomationRuleDto>(`/automation/rules/${id}`, body),
  enableRule: (id: string) => api.post<AutomationRuleDto>(`/automation/rules/${id}/enable`),
  disableRule: (id: string) => api.post<AutomationRuleDto>(`/automation/rules/${id}/disable`),
  listWorkflows: () => api.get<WorkflowDto[]>('/automation/workflows'),
  getWorkflow: (id: string) => api.get<WorkflowDto>(`/automation/workflows/${id}`),
  listWorkflowTemplates: () => api.get<{items:WorkflowTemplateDto[]}>('/automation/workflow-templates'),
  triggerWorkflow: (id: string, input: Record<string,unknown> = {}) => api.post<WorkflowExecutionDto>(`/automation/workflows/${id}/trigger`, { input }),
  pauseWorkflow: (id: string) => api.post<WorkflowDto>(`/automation/workflows/${id}/pause`),
  resumeWorkflow: (id: string) => api.post<WorkflowDto>(`/automation/workflows/${id}/resume`),
  listWorkflowExecutions: () => api.get<{items:WorkflowExecutionDto[]}>('/automation/workflow-executions'),
  controlExecution: (id: string, action: 'pause'|'resume'|'cancel'|'retry') => api.post<WorkflowExecutionDto>(`/automation/workflow-executions/${id}/${action}`),
  workflowAnalytics: () => api.get<WorkflowAnalyticsDto>('/automation/workflow-analytics'),
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
  transferOwnership: (memberId: string, businessName: string) => api.post<{ businessId: string; previousOwnerUserId: string; ownerUserId: string }>('/team/ownership-transfer', { memberId, businessName }),
};
export const publicTeamInvitesApi = {
  get: (token: string) => api.get<PublicTeamInvitationDto>(`/public/team-invites/${encodeURIComponent(token)}`, 'none'),
  accept: (token: string) => api.post<{ state: 'accepted' | 'expired' | 'already-used' }>(`/public/team-invites/${encodeURIComponent(token)}/accept`),
};

export const aiApi = {
  monitoring: (sinceHours = 168) => api.get<Record<string, unknown>>(`/ai/ops/monitoring${query({ sinceHours })}`),
  trends: (metric: string, sinceHours = 168, bucket: 'hour' | 'day' = 'day') => api.get<{ metric: string; bucket: string; points: Array<Record<string, unknown>> }>(`/ai/ops/trends${query({ metric, sinceHours, bucket })}`),
  health: () => api.get<AiHealthDto>('/ai/ops/health'),
  analytics: () => api.get<AiValueCenterDto>('/ai/ops/analytics'),
  verifyOutcomes: () => api.post<{ checked: number; verified: number }>('/ai/ops/analytics/verify', {}),
  listRuns: (status?: string, limit = 50) => api.get<AiConversationRunDto[]>(`/ai/ops/runs${query({ status, limit })}`),
  getRun: (id: string) => api.get<AiConversationRunDto>(`/ai/ops/runs/${id}`),
  approveRun: (id: string, attributeOutcome?: { outcomeType: string; outcomeId: string; amount?: number; currency?: string }) => api.post<AiConversationRunDto>(`/ai/ops/runs/${id}/approve`, attributeOutcome ? { attributeOutcome } : {}),
  escalateRun: (id: string) => api.post<AiConversationRunDto>(`/ai/ops/runs/${id}/escalate`, {}),
  evaluationRuns: (suiteId: string) => api.get<AiEvaluationRunDto[]>(`/ai/ops/evaluations/suites/${suiteId}/runs`),
  evaluationRun: (id: string) => api.get<AiEvaluationRunDto & { results: Array<Record<string, unknown>> }>(`/ai/ops/evaluations/runs/${id}`),
};

import type {
  CustomerSessionResponse, CustomerSelfProfileDto, CustomerDashboardDto,
  CustomerNotificationDto, CustomerBusinessLinkDto,
} from '../apiTypes';

export const customerAuthApi = {
  register: (body: { email: string; password: string; fullName: string; displayName?: string; phone?: string }) =>
    api.post<CustomerSessionResponse>('/customer/auth/register', body, 'none'),
  login: (body: { email: string; password: string }) => api.post<CustomerSessionResponse>('/customer/auth/login', body, 'none'),
  google: (idToken: string) => api.post<CustomerSessionResponse>('/customer/auth/google', { idToken }, 'none'),
  appleChallenge: () => api.post<{ challengeId: string; nonce: string; state: string }>('/customer/auth/apple/challenge', {}, 'none'),
  apple: (body: Record<string, unknown>) => api.post<CustomerSessionResponse>('/customer/auth/apple', body, 'none'),
  refresh: (refreshToken: string) => api.post<{ accessToken: string; refreshToken: string; expiresIn: number }>('/customer/auth/refresh', { refreshToken }, 'none'),
  logout: (refreshToken: string) => api.post<void>('/customer/auth/logout', { refreshToken }, 'none'),
  logoutAll: () => api.post<{ revoked: number }>('/customer/auth/logout-all'),
  me: () => api.get<{ user: CustomerSessionResponse['user']; profile: CustomerSelfProfileDto }>('/customer/auth/me'),
  forgotPassword: (email: string) => api.post<{ message: string }>('/customer/auth/forgot-password', { email }, 'none'),
  resetPassword: (token: string, password: string) => api.post<{ message: string }>('/customer/auth/reset-password', { token, password }, 'none'),
  verifyEmail: (token: string) => api.post<{ verified: boolean }>('/customer/auth/verify-email', { token }, 'none'),
  resendVerification: () => api.post<{ sent?: boolean; alreadyVerified?: boolean }>('/customer/auth/resend-verification'),
  listSessions: () => api.get<Array<{ id: string; ipAddress: string | null; userAgent: string | null; lastUsedAt: string | null; createdAt: string }>>('/customer/auth/sessions'),
  revokeSession: (id: string) => api.delete<void>(`/customer/auth/sessions/${id}`),
  registerDevice: (token: string, platform: 'ios' | 'android' | 'web') => api.post<{ id: string }>('/customer/auth/devices', { token, platform }),
  removeDevice: (token: string) => api.delete<void>(`/customer/auth/devices/${encodeURIComponent(token)}`),
};

export const customerApi = {
  profile: () => api.get<CustomerSelfProfileDto & { user: CustomerSessionResponse['user'] }>('/customer/profile'),
  updateProfile: (body: Partial<{ displayName: string; avatarUrl: string | null; phone: string | null; preferredLanguage: string; preferredTimezone: string }>) => api.patch<CustomerSelfProfileDto>('/customer/profile', body),
  updatePreferences: (body: { notificationPreferences?: Record<string, Record<string, boolean>>; privacySettings?: Record<string, unknown>; communicationPreferences?: Record<string, unknown>; marketingConsent?: boolean }) => api.patch<CustomerSelfProfileDto>('/customer/profile/preferences', body),
  closeAccount: () => api.delete<void>('/customer/profile'),
  businesses: () => api.get<CustomerBusinessLinkDto[]>('/customer/businesses'),
  setFavourite: (businessId: string, favourite: boolean) => api.patch<CustomerBusinessLinkDto>(`/customer/businesses/${businessId}/favourite`, { favourite }),
  dashboard: () => api.get<CustomerDashboardDto>('/customer/dashboard'),
  activity: (limit = 50) => api.get<Array<{ id: string; type: string; createdAt: string }>>(`/customer/activity${query({ limit })}`),
  notifications: (unreadOnly = false) => api.get<CustomerNotificationDto[]>(`/customer/notifications${query({ unreadOnly: unreadOnly ? 'true' : undefined })}`),
  markNotificationRead: (id: string) => api.post<CustomerNotificationDto>(`/customer/notifications/${id}/read`),
  markAllNotificationsRead: () => api.post<{ updated: number }>('/customer/notifications/read-all'),
  notificationPreferences: () => api.get<{ notificationPreferences: Record<string, Record<string, boolean>>; communicationPreferences: Record<string, unknown> }>('/customer/notifications/preferences'),
  setNotificationPreferences: (notificationPreferences: Record<string, Record<string, boolean>>) => api.patch<CustomerSelfProfileDto>('/customer/notifications/preferences', { notificationPreferences }),
  aiConversations: () => api.get<{ conversations: Array<Record<string, unknown>> }>('/customer/ai/conversations'),
  aiContext: () => api.get<Record<string, unknown>>('/customer/ai/context'),
};
