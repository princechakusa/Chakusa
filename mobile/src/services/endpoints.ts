import { AttentionCategory, AttentionPageDto, AuthResponse, BusinessDto, CustomerDto, CustomerListResponse, CustomerProfileDto, DashboardSummaryDto, FeedbackDto, LeadDto, LeadListResponse, LeadStatus, MeResponse, MessageTemplateDto, ReminderDto, ReviewRequestDto, SubscriptionStatusDto } from '../apiTypes';
import { api } from './api';
import { AppleChallenge, AppleCredentialPayload } from './appleAuth';

const query = (values: Record<string, string | number | undefined>) => { const params = new URLSearchParams(); Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); }); const encoded = params.toString(); return encoded ? `?${encoded}` : ''; };

export const authApi = {
  register: (body: { email: string; password: string; fullName: string; businessName: string; industry?: string }) => api.post<AuthResponse>('/auth/register', body, 'none'),
  login: (body: { email: string; password: string }) => api.post<AuthResponse>('/auth/login', body, 'none'),
  google: (idToken: string) => api.post<AuthResponse>('/auth/google', { idToken }, 'none'),
  linkGoogle: (idToken: string) => api.post<{ provider: 'GOOGLE'; providerEmail: string; linkedAt: string }>('/auth/google/link', { idToken }),
  appleChallenge: () => api.post<AppleChallenge>('/auth/apple/challenge', {}, 'none'),
  apple: (body: AppleCredentialPayload) => api.post<AuthResponse>('/auth/apple', body, 'none'),
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
};
export const leadsApi = {
  list: (status?: LeadStatus, page = 1, pageSize = 100) => api.get<LeadListResponse>(`/leads${query({ status, page, pageSize })}`),
  create: (body: { customerId?: string; source?: string; missedCallTime?: string; serviceRequested?: string; urgency?: 'low' | 'medium' | 'high'; estimatedValue?: number; notes?: string }) => api.post<LeadDto>('/leads', body),
  get: (id: string) => api.get<LeadDto>(`/leads/${id}`), patch: (id: string, body: Partial<Pick<LeadDto, 'customerId' | 'source' | 'serviceRequested' | 'urgency' | 'estimatedValue' | 'notes' | 'status'>>) => api.patch<LeadDto>(`/leads/${id}`, body),
  generateMessage: (id: string) => api.post<{ message: string }>(`/leads/${id}/generate-message`),
  transition: (id: string, status: Exclude<LeadStatus, 'new'>) => api.post<LeadDto>(`/leads/${id}/mark-${status}`),
};
export const reviewsApi = {
  list: () => api.get<ReviewRequestDto[]>('/review-requests'), create: (body: { customerId?: string; serviceName?: string; message?: string }) => api.post<ReviewRequestDto>('/review-requests', body),
  get: (id: string) => api.get<ReviewRequestDto>(`/review-requests/${id}`), patch: (id: string, body: Partial<Pick<ReviewRequestDto, 'serviceName' | 'message' | 'status'>>) => api.patch<ReviewRequestDto>(`/review-requests/${id}`, body),
  generateMessage: (id: string) => api.post<{ message: string }>(`/review-requests/${id}/generate-message`), markOpened: (id: string) => api.post<ReviewRequestDto>(`/review-requests/${id}/mark-opened`), markSent: (id: string) => api.post<ReviewRequestDto>(`/review-requests/${id}/mark-sent`), markReviewed: (id: string) => api.post<ReviewRequestDto>(`/review-requests/${id}/mark-reviewed`), markFeedbackReceived: (id: string) => api.post<ReviewRequestDto>(`/review-requests/${id}/mark-feedback-received`),
};
export const feedbackApi = { list: () => api.get<FeedbackDto[]>('/feedback'), create: (body: { customerId?: string; reviewRequestId?: string; rating: number; comment?: string }) => api.post<FeedbackDto>('/feedback', body) };
export const remindersApi = {
  list: () => api.get<ReminderDto[]>('/reminders'), create: (body: { customerId?: string; serviceName?: string; lastVisitDate?: string; dueDate?: string }) => api.post<ReminderDto>('/reminders', body), get: (id: string) => api.get<ReminderDto>(`/reminders/${id}`), patch: (id: string, body: Partial<Pick<ReminderDto, 'serviceName' | 'lastVisitDate' | 'dueDate' | 'status'>>) => api.patch<ReminderDto>(`/reminders/${id}`, body), generateMessage: (id: string) => api.post<{ message: string }>(`/reminders/${id}/generate-message`), markSent: (id: string) => api.post<ReminderDto>(`/reminders/${id}/mark-sent`), markCompleted: (id: string) => api.post<ReminderDto>(`/reminders/${id}/mark-completed`), dismiss: (id: string) => api.post<ReminderDto>(`/reminders/${id}/dismiss`),
};
export const templatesApi = { list: () => api.get<MessageTemplateDto[]>('/message-templates'), create: (body: { templateType: MessageTemplateDto['templateType']; name: string; body: string; tone?: MessageTemplateDto['tone']; isDefault?: boolean }) => api.post<MessageTemplateDto>('/message-templates', body), patch: (id: string, body: Partial<Pick<MessageTemplateDto, 'templateType' | 'name' | 'body' | 'tone' | 'isDefault'>>) => api.patch<MessageTemplateDto>(`/message-templates/${id}`, body) };
export const subscriptionApi = { getStatus: () => api.get<SubscriptionStatusDto>('/subscription/status') };
