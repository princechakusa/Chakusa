import { z } from "zod";

export const verifyAppleSubscriptionSchema = z.object({
  // The App Store transaction identifier from mobile's StoreKit 2 purchase
  // result — NOT trusted on its own; the backend re-queries Apple's
  // GetAllSubscriptionStatuses for it (see subscriptionReconciliation.ts).
  transactionId: z.string().trim().min(1),
});
export type VerifyAppleSubscriptionInput = z.infer<typeof verifyAppleSubscriptionSchema>;

export const verifyGoogleSubscriptionSchema = z.object({
  // The Play Billing purchase token from mobile's purchase result — NOT
  // trusted on its own; the backend re-queries the Play Developer API's
  // subscriptionsv2.get for it.
  purchaseToken: z.string().trim().min(1),
});
export type VerifyGoogleSubscriptionInput = z.infer<typeof verifyGoogleSubscriptionSchema>;
