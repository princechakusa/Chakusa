// PROGRAM 2 LOOP 7: the CUSTOMER API surface.
//
// These clients are byte-for-byte the same routes the business-app file
// `src/services/endpoints.ts` already declares for the customer backend
// (Program 2 Loops 1-5). They are re-declared here ONLY so they run
// through `customerHttp` — the transport bound to the namespaced customer
// session (`chakusa.customer.session.v1`) and `/customer/auth/refresh` —
// instead of the shared business `api` singleton. A customer build never
// imports `src/services/endpoints.ts`; a business build never imports
// this file. Token scope stays fully separated (Loop 7 spec §13, §53).

import type {
  CustomerSessionResponse, CustomerSelfProfileDto, CustomerDashboardDto,
  CustomerNotificationDto, CustomerBusinessLinkDto,
  MarketplaceDiscoveryMode, MarketplacePageDto, MarketplaceCategoriesResponse,
  MarketplaceSuggestionsDto, MarketplaceRecentSearchDto, MarketplaceBusinessProfileDto,
  MarketplacePromotionDto, MarketplaceShareDto, MarketplaceCardDto,
  BookableServicesDto, BookingAvailabilityDto, CustomerBookingDto, CreateBookingResponseDto, BookingScope,
  CustomerAIConversationDto, CustomerAIConversationListDto, CustomerAIConversationDetailDto,
  CustomerAITurnResponseDto, CustomerAIRecommendationDto, CustomerAISettingsDto,
  LegalAcceptanceStatusDto, LegalDocumentDto, LegalDocumentType,
  WalletDto, LoyaltyAccountSummaryDto, LoyaltyRewardDto, LoyaltyTransactionDto,
  RewardRedemptionDto, CustomerMembershipDto, MembershipPlanDto,
  ReferralOverviewDto, ReferralCodeDto,
} from '../apiTypes';
import { customerHttp } from './customerApi';

const query = (values: Record<string, string | number | boolean | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
};

export const customerAuthApi = {
  register: (body: { email: string; password: string; fullName: string; displayName?: string; phone?: string }) =>
    customerHttp.post<CustomerSessionResponse>('/customer/auth/register', body, 'none'),
  login: (body: { email: string; password: string }) => customerHttp.post<CustomerSessionResponse>('/customer/auth/login', body, 'none'),
  google: (idToken: string) => customerHttp.post<CustomerSessionResponse>('/customer/auth/google', { idToken }, 'none'),
  appleChallenge: () => customerHttp.post<{ challengeId: string; nonce: string; state: string; expiresAt: string }>('/customer/auth/apple/challenge', {}, 'none'),
  apple: (body: Record<string, unknown>) => customerHttp.post<CustomerSessionResponse>('/customer/auth/apple', body, 'none'),
  refresh: (refreshToken: string) => customerHttp.post<{ accessToken: string; refreshToken: string; expiresIn: number }>('/customer/auth/refresh', { refreshToken }, 'none'),
  logout: (refreshToken: string) => customerHttp.post<void>('/customer/auth/logout', { refreshToken }, 'none'),
  logoutAll: () => customerHttp.post<{ revoked: number }>('/customer/auth/logout-all'),
  me: () => customerHttp.get<{ user: CustomerSessionResponse['user']; profile: CustomerSelfProfileDto }>('/customer/auth/me'),
  forgotPassword: (email: string) => customerHttp.post<{ message: string }>('/customer/auth/forgot-password', { email }, 'none'),
  resetPassword: (token: string, password: string) => customerHttp.post<{ message: string }>('/customer/auth/reset-password', { token, password }, 'none'),
  resendVerification: () => customerHttp.post<{ sent?: boolean; alreadyVerified?: boolean }>('/customer/auth/resend-verification'),
  listSessions: () => customerHttp.get<Array<{ id: string; ipAddress: string | null; userAgent: string | null; lastUsedAt: string | null; createdAt: string }>>('/customer/auth/sessions'),
  revokeSession: (id: string) => customerHttp.delete<void>(`/customer/auth/sessions/${id}`),
  registerDevice: (token: string, platform: 'ios' | 'android' | 'web') => customerHttp.post<{ id: string }>('/customer/auth/devices', { token, platform }),
  removeDevice: (token: string) => customerHttp.delete<void>(`/customer/auth/devices/${encodeURIComponent(token)}`),
};

export const customerApi = {
  profile: () => customerHttp.get<CustomerSelfProfileDto & { user: CustomerSessionResponse['user'] }>('/customer/profile'),
  updateProfile: (body: Partial<{ displayName: string; avatarUrl: string | null; phone: string | null; preferredLanguage: string; preferredTimezone: string }>) =>
    customerHttp.patch<CustomerSelfProfileDto>('/customer/profile', body),
  updatePreferences: (body: { notificationPreferences?: Record<string, Record<string, boolean>>; privacySettings?: Record<string, unknown>; communicationPreferences?: Record<string, unknown>; marketingConsent?: boolean }) =>
    customerHttp.patch<CustomerSelfProfileDto>('/customer/profile/preferences', body),
  closeAccount: () => customerHttp.delete<void>('/customer/profile'),
  businesses: () => customerHttp.get<CustomerBusinessLinkDto[]>('/customer/businesses'),
  setFavourite: (businessId: string, favourite: boolean) => customerHttp.patch<CustomerBusinessLinkDto>(`/customer/businesses/${businessId}/favourite`, { favourite }),
  dashboard: () => customerHttp.get<CustomerDashboardDto>('/customer/dashboard'),
  activity: (limit = 50) => customerHttp.get<Array<{ id: string; type: string; createdAt: string }>>(`/customer/activity${query({ limit })}`),
  notifications: (unreadOnly = false) => customerHttp.get<CustomerNotificationDto[]>(`/customer/notifications${query({ unreadOnly: unreadOnly ? 'true' : undefined })}`),
  markNotificationRead: (id: string) => customerHttp.post<CustomerNotificationDto>(`/customer/notifications/${id}/read`),
  markAllNotificationsRead: () => customerHttp.post<{ updated: number }>('/customer/notifications/read-all'),
  notificationPreferences: () => customerHttp.get<{ notificationPreferences: Record<string, Record<string, boolean>>; communicationPreferences: Record<string, unknown> }>('/customer/notifications/preferences'),
  setNotificationPreferences: (notificationPreferences: Record<string, Record<string, boolean>>) =>
    customerHttp.patch<CustomerSelfProfileDto>('/customer/notifications/preferences', { notificationPreferences }),
};

export const marketplaceApi = {
  discover: (params: { mode?: MarketplaceDiscoveryMode; category?: string; q?: string; city?: string; verifiedOnly?: boolean; lat?: number; lng?: number; radiusKm?: number; limit?: number; cursor?: string } = {}) =>
    customerHttp.get<MarketplacePageDto>(`/customer/marketplace${query({ ...params, verifiedOnly: params.verifiedOnly ? 'true' : undefined })}`),
  nearby: (lat: number, lng: number, radiusKm = 15, limit?: number) =>
    customerHttp.get<MarketplacePageDto>(`/customer/marketplace/nearby${query({ lat, lng, radiusKm, limit })}`),
  featured: (limit?: number) => customerHttp.get<MarketplacePageDto>(`/customer/marketplace/featured${query({ limit })}`),
  recent: (limit?: number) => customerHttp.get<MarketplacePageDto>(`/customer/marketplace/recent${query({ limit })}`),
  popular: (limit?: number) => customerHttp.get<MarketplacePageDto>(`/customer/marketplace/popular${query({ limit })}`),
  verified: (limit?: number) => customerHttp.get<MarketplacePageDto>(`/customer/marketplace/verified${query({ limit })}`),
  categories: () => customerHttp.get<MarketplaceCategoriesResponse>('/customer/marketplace/categories'),
  categoryBusinesses: (slug: string, params: { q?: string; limit?: number; cursor?: string } = {}) =>
    customerHttp.get<MarketplacePageDto>(`/customer/marketplace/categories/${encodeURIComponent(slug)}${query(params)}`),
  search: (q: string, params: { category?: string; city?: string; verifiedOnly?: boolean; limit?: number; cursor?: string } = {}) =>
    customerHttp.get<MarketplacePageDto>(`/customer/marketplace/search${query({ q, ...params, verifiedOnly: params.verifiedOnly ? 'true' : undefined })}`),
  suggestions: (q: string) => customerHttp.get<MarketplaceSuggestionsDto>(`/customer/marketplace/search/suggestions${query({ q })}`),
  recentSearches: () => customerHttp.get<MarketplaceRecentSearchDto[]>('/customer/marketplace/search/recent'),
  business: (slug: string) => customerHttp.get<MarketplaceBusinessProfileDto>(`/customer/marketplace/businesses/${encodeURIComponent(slug)}`),
  setFavourite: (slug: string, favourite: boolean) => customerHttp.post<CustomerBusinessLinkDto & { favouriteCount: number }>(`/customer/marketplace/businesses/${encodeURIComponent(slug)}/favourite`, { favourite }),
  setFollow: (slug: string, follow: boolean) => customerHttp.post<{ following: boolean; followerCount: number }>(`/customer/marketplace/businesses/${encodeURIComponent(slug)}/follow`, { follow }),
  report: (slug: string, reason: string, detail?: string) => customerHttp.post<{ id: string; status: string }>(`/customer/marketplace/businesses/${encodeURIComponent(slug)}/report`, { reason, detail }),
  share: (slug: string) => customerHttp.get<MarketplaceShareDto>(`/customer/marketplace/businesses/${encodeURIComponent(slug)}/share`),
  recentlyViewed: () => customerHttp.get<MarketplaceCardDto[]>('/customer/marketplace/recently-viewed'),
  favourites: () => customerHttp.get<MarketplaceCardDto[]>('/customer/marketplace/favourites'),
  following: () => customerHttp.get<MarketplaceCardDto[]>('/customer/marketplace/following'),
  promotions: () => customerHttp.get<MarketplacePromotionDto[]>('/customer/marketplace/promotions'),
};

export const bookingApi = {
  services: (slug: string) => customerHttp.get<BookableServicesDto>(`/customer/bookings/businesses/${encodeURIComponent(slug)}/services`),
  availability: (slug: string, serviceOfferingId: string, from: string, to: string, memberId?: string) =>
    customerHttp.get<BookingAvailabilityDto>(`/customer/bookings/businesses/${encodeURIComponent(slug)}/availability${query({ serviceOfferingId, from, to, memberId })}`),
  create: (body: { slug: string; serviceOfferingId: string; assignedMemberId?: string; startsAt: string; notes?: string }) =>
    customerHttp.post<CreateBookingResponseDto>('/customer/bookings', body),
  list: (scope: BookingScope = 'all') => customerHttp.get<CustomerBookingDto[]>(`/customer/bookings${query({ scope })}`),
  get: (id: string) => customerHttp.get<CustomerBookingDto>(`/customer/bookings/${id}`),
  reschedule: (id: string, startsAt: string, assignedMemberId?: string) =>
    customerHttp.patch<CustomerBookingDto>(`/customer/bookings/${id}/reschedule`, { startsAt, assignedMemberId }),
  cancel: (id: string) => customerHttp.post<CustomerBookingDto>(`/customer/bookings/${id}/cancel`),
};

export const customerAssistantApi = {
  createConversation: (body: { title?: string; businessSlug?: string } = {}) =>
    customerHttp.post<CustomerAIConversationDto>('/customer/ai/assistant/conversations', body),
  listConversations: (params: { archived?: boolean; q?: string; cursor?: string; limit?: number } = {}) =>
    customerHttp.get<CustomerAIConversationListDto>(`/customer/ai/assistant/conversations${query({ ...params, archived: params.archived === undefined ? undefined : String(params.archived) })}`),
  getConversation: (id: string, params: { cursor?: string; limit?: number } = {}) =>
    customerHttp.get<CustomerAIConversationDetailDto>(`/customer/ai/assistant/conversations/${id}${query(params)}`),
  sendMessage: (id: string, content: string) =>
    customerHttp.post<CustomerAITurnResponseDto>(`/customer/ai/assistant/conversations/${id}/messages`, { content }),
  updateConversation: (id: string, patch: { title?: string; pinned?: boolean; archived?: boolean }) =>
    customerHttp.patch<CustomerAIConversationDto>(`/customer/ai/assistant/conversations/${id}`, patch),
  deleteConversation: (id: string) => customerHttp.delete<{ deleted: boolean }>(`/customer/ai/assistant/conversations/${id}`),
  rateMessage: (messageId: string, rating: -1 | 0 | 1, note?: string) =>
    customerHttp.post<{ id: string; rating: number | null }>(`/customer/ai/assistant/messages/${messageId}/feedback`, { rating, note }),
  recommendations: (params: { lat?: number; lng?: number; limit?: number } = {}) =>
    customerHttp.get<{ recommendations: CustomerAIRecommendationDto[] }>(`/customer/ai/assistant/recommendations${query(params)}`),
  getSettings: () => customerHttp.get<CustomerAISettingsDto>('/customer/ai/assistant/settings'),
  updateSettings: (patch: Partial<CustomerAISettingsDto>) =>
    customerHttp.patch<CustomerAISettingsDto>('/customer/ai/assistant/settings', patch),
};

export const legalApi = {
  document: (type: LegalDocumentType) => customerHttp.get<LegalDocumentDto>(`/legal/documents/${type}`, 'none'),
  customerStatus: () => customerHttp.get<LegalAcceptanceStatusDto>('/customer/legal/status'),
  customerAccept: (type: LegalDocumentType, body: { source: string; cookiePreferences?: { analytics: boolean; functional: boolean; marketing: boolean } } = { source: 'app' }) =>
    customerHttp.post<{ id: string }>('/customer/legal/accept', { type, ...body }),
};

// PROGRAM 2 LOOP 8: customer loyalty, rewards, memberships & referrals.
// Same `/customer/loyalty/*` routes as Program 2 Loop 5, routed through the
// customer transport. Read + a handful of customer actions (enrol, redeem a
// reward, enrol/cancel a membership, referral code/redeem). No payment
// surface: membership enrolment records the entitlement without a charge.
export const loyaltyApi = {
  wallet: () => customerHttp.get<WalletDto>('/customer/loyalty/wallet'),
  accounts: () => customerHttp.get<WalletDto['accounts']>('/customer/loyalty/accounts'),
  account: (businessId: string) => customerHttp.get<LoyaltyAccountSummaryDto>(`/customer/loyalty/accounts/${businessId}`),
  transactions: (businessId: string, params: { cursor?: string; limit?: number } = {}) =>
    customerHttp.get<{ items: LoyaltyTransactionDto[]; nextCursor: string | null }>(`/customer/loyalty/accounts/${businessId}/transactions${query(params)}`),
  enrol: (businessId: string) => customerHttp.post<{ id: string }>(`/customer/loyalty/accounts/${businessId}/enrol`),
  rewards: (businessId: string) => customerHttp.get<LoyaltyRewardDto[]>(`/customer/loyalty/accounts/${businessId}/rewards`),
  redeemReward: (businessId: string, rewardId: string) =>
    customerHttp.post<{ id: string; code: string; status: RewardRedemptionDto['status']; pointsSpent: number; reward: { name: string; type: string; value: number | null } | null; expiresAt: string | null }>(`/customer/loyalty/accounts/${businessId}/rewards/${rewardId}/redeem`),
  myRedemptions: (status?: RewardRedemptionDto['status']) =>
    customerHttp.get<RewardRedemptionDto[]>(`/customer/loyalty/rewards${query({ status })}`),
  memberships: () => customerHttp.get<CustomerMembershipDto[]>('/customer/loyalty/memberships'),
  membershipPlans: (slug: string) => customerHttp.get<MembershipPlanDto[]>(`/customer/loyalty/businesses/${encodeURIComponent(slug)}/membership-plans`),
  enrolMembership: (slug: string, planId: string) =>
    customerHttp.post<{ id: string; status: string }>(`/customer/loyalty/businesses/${encodeURIComponent(slug)}/memberships`, { planId }),
  cancelMembership: (id: string, immediate = false) =>
    customerHttp.post<{ id: string; status: string; cancelAtPeriodEnd?: boolean }>(`/customer/loyalty/memberships/${id}/cancel`, { immediate }),
  referrals: () => customerHttp.get<ReferralOverviewDto>('/customer/loyalty/referrals'),
  referralCode: (businessSlug?: string) =>
    customerHttp.post<ReferralCodeDto>('/customer/loyalty/referrals/code', businessSlug ? { businessSlug } : {}),
  redeemReferral: (code: string) =>
    customerHttp.post<{ referralId: string; status: string }>('/customer/loyalty/referrals/redeem', { code }),
};
