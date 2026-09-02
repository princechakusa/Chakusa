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
  // Loop 7 leaves this location intentionally in place; the full rewards
  // experience is Loop 8. The screen currently explains that.
  CustomerRewards: undefined;
  EditCustomerProfile: undefined;
  CustomerLegalDocument: { type: import('../../apiTypes').LegalDocumentType };
};
