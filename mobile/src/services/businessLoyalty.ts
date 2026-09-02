import type {
  BusinessMembershipPlanDto,
  BusinessMembershipPlanInput,
  BusinessRedemptionDto,
  BusinessRewardDto,
  BusinessRewardInput,
  LoyaltyBusinessAnalyticsDto,
  LoyaltyCampaignDto,
  LoyaltyCampaignInput,
  LoyaltyMemberPageDto,
  LoyaltyProgramDto,
  LoyaltyProgramInput,
  PointAdjustmentResultDto,
} from '../apiTypes';
import { api } from './api';

// PROGRAM 2 LOOP 6: the mobile business app's client for the existing
// /loyalty/* management API (Program 2 Loop 5). No new engine — this only
// calls the approved production routes with the business (PRODUCT) session.

const query = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => { if (value !== undefined && value !== '') params.set(key, String(value)); });
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
};

export const businessLoyaltyApi = {
  getProgram: () => api.get<LoyaltyProgramDto>('/loyalty/program'),
  saveProgram: (body: LoyaltyProgramInput) => api.put<LoyaltyProgramDto>('/loyalty/program', body),

  listRewards: (activeOnly = false) => api.get<BusinessRewardDto[]>(`/loyalty/rewards${query({ activeOnly: activeOnly ? 'true' : undefined })}`),
  createReward: (body: BusinessRewardInput) => api.post<BusinessRewardDto>('/loyalty/rewards', body),
  updateReward: (id: string, body: Partial<BusinessRewardInput> & { active?: boolean }) => api.patch<BusinessRewardDto>(`/loyalty/rewards/${id}`, body),
  deleteReward: (id: string) => api.delete<{ deactivated: string }>(`/loyalty/rewards/${id}`),

  listMembershipPlans: () => api.get<BusinessMembershipPlanDto[]>('/loyalty/membership-plans'),
  createMembershipPlan: (body: BusinessMembershipPlanInput) => api.post<BusinessMembershipPlanDto>('/loyalty/membership-plans', body),
  updateMembershipPlan: (id: string, body: Partial<BusinessMembershipPlanInput> & { active?: boolean }) => api.patch<BusinessMembershipPlanDto>(`/loyalty/membership-plans/${id}`, body),
  deleteMembershipPlan: (id: string) => api.delete<{ deactivated: string }>(`/loyalty/membership-plans/${id}`),

  listCampaigns: (activeOnly = false) => api.get<LoyaltyCampaignDto[]>(`/loyalty/campaigns${query({ activeOnly: activeOnly ? 'true' : undefined })}`),
  createCampaign: (body: LoyaltyCampaignInput) => api.post<LoyaltyCampaignDto>('/loyalty/campaigns', body),
  updateCampaign: (id: string, body: Partial<LoyaltyCampaignInput> & { active?: boolean }) => api.patch<LoyaltyCampaignDto>(`/loyalty/campaigns/${id}`, body),
  deleteCampaign: (id: string) => api.delete<{ deleted: boolean }>(`/loyalty/campaigns/${id}`),

  listRedemptions: (params: { status?: string; code?: string } = {}) => api.get<BusinessRedemptionDto[]>(`/loyalty/redemptions${query(params)}`),
  markRedeemed: (id: string, appointmentId?: string) => api.post<BusinessRedemptionDto>(`/loyalty/redemptions/${id}/mark-redeemed`, appointmentId ? { appointmentId } : {}),
  revokeRedemption: (id: string, reason: string, refundPoints = true) => api.post<{ revoked: boolean }>(`/loyalty/redemptions/${id}/revoke`, { reason, refundPoints }),

  listMembers: (params: { page?: number; pageSize?: number; tierKey?: string } = {}) => api.get<LoyaltyMemberPageDto>(`/loyalty/accounts${query(params)}`),
  adjustPoints: (customerProfileId: string, points: number, reason: string) => api.post<PointAdjustmentResultDto>(`/loyalty/accounts/${customerProfileId}/adjust`, { points, reason }),

  analytics: () => api.get<LoyaltyBusinessAnalyticsDto>('/loyalty/analytics'),
};
