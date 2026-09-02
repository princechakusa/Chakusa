import type { NavigatorScreenParams } from '@react-navigation/native';

// PROGRAM 2 LOOP 7: the customer app's route map. Kept entirely separate
// from the business `RootStackParamList` in `src/types.ts`.

export type CustomerTabParamList = {
  CustomerHome: undefined;
  CustomerExplore: undefined;
  CustomerBookings: undefined;
  CustomerAccount: undefined;
};

export type CustomerRootStackParamList = {
  CustomerAuth: undefined;
  CustomerLegalGate: undefined;
  CustomerTabs: NavigatorScreenParams<CustomerTabParamList> | undefined;
  BusinessProfile: { slug: string };
  BookingFlow: { slug: string; serviceId?: string };
  BookingDetail: { bookingId: string };
  CustomerNotifications: undefined;
  CustomerAssistant: { conversationId?: string } | undefined;
  // PROGRAM 2 LOOP 8: the customer loyalty experience. `CustomerRewards` is
  // the hub reached from Account → My Rewards; the rest push onto this same
  // stack.
  CustomerRewards: undefined;
  CustomerLoyaltyBusiness: { businessId: string; slug?: string; businessName?: string };
  CustomerLoyaltyHistory: { businessId: string; businessName?: string };
  CustomerRewardDetail: { businessId: string; businessName?: string; reward: import('../../apiTypes').LoyaltyRewardDto };
  CustomerRedemptions: undefined;
  CustomerRedemptionDetail: { redemption: import('../../apiTypes').RewardRedemptionDto };
  CustomerMemberships: undefined;
  CustomerMembershipPlans: { slug: string; businessName?: string };
  CustomerReferrals: undefined;
  EditCustomerProfile: undefined;
  CustomerLegalDocument: { type: import('../../apiTypes').LegalDocumentType };
};
