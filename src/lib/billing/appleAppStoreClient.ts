import { importPKCS8, SignJWT } from "jose";
import { config } from "../config.js";
import { verifyAppleSignedPayload } from "./jws.js";

const SANDBOX_BASE_URL = "https://api.storekit-sandbox.itunes.apple.com";
const PRODUCTION_BASE_URL = "https://api.storekit.itunes.apple.com";

export interface AppleBillingConfig {
  bundleId: string;
  issuerId: string;
  keyId: string;
  privateKey: string;
  environment: "SANDBOX" | "PRODUCTION";
  proMonthlyProductId: string;
}

export function requireAppleBillingConfig(): AppleBillingConfig {
  const { APPLE_BILLING_ENABLED, APPLE_BUNDLE_ID, APPLE_BILLING_ISSUER_ID, APPLE_BILLING_KEY_ID, APPLE_BILLING_PRIVATE_KEY_BASE64, APPLE_PRO_MONTHLY_PRODUCT_ID, APPLE_STORE_ENVIRONMENT } = config;
  if (!APPLE_BILLING_ENABLED || !APPLE_BUNDLE_ID || !APPLE_BILLING_ISSUER_ID || !APPLE_BILLING_KEY_ID || !APPLE_BILLING_PRIVATE_KEY_BASE64 || !APPLE_PRO_MONTHLY_PRODUCT_ID) {
    throw new Error("Apple billing is not configured");
  }
  return {
    bundleId: APPLE_BUNDLE_ID,
    issuerId: APPLE_BILLING_ISSUER_ID,
    keyId: APPLE_BILLING_KEY_ID,
    privateKey: Buffer.from(APPLE_BILLING_PRIVATE_KEY_BASE64, "base64").toString("utf8"),
    environment: APPLE_STORE_ENVIRONMENT,
    proMonthlyProductId: APPLE_PRO_MONTHLY_PRODUCT_ID,
  };
}

/**
 * App Store Server API auth token — a short-lived JWT signed with the
 * dedicated In-App Purchase key (see config.ts's APPLE_BILLING_* doc
 * comment), structurally the same ES256-signed-JWT shape as appleAuth.ts's
 * clientSecret() but for a different audience/purpose and a different key.
 */
async function appStoreServerApiToken(apple: AppleBillingConfig): Promise<string> {
  const key = await importPKCS8(apple.privateKey, "ES256");
  return new SignJWT({ bid: apple.bundleId })
    .setProtectedHeader({ alg: "ES256", kid: apple.keyId, typ: "JWT" })
    .setIssuer(apple.issuerId)
    .setAudience("appstoreconnect-v1")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

function baseUrl(environment: "SANDBOX" | "PRODUCTION"): string {
  return environment === "PRODUCTION" ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;
}

export interface JWSTransactionDecodedPayload {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  purchaseDate: number;
  originalPurchaseDate: number;
  expiresDate?: number;
  type: string;
  inAppOwnershipType: string;
  signedDate: number;
  environment: "Sandbox" | "Production";
  revocationDate?: number;
  revocationReason?: number;
  appAccountToken?: string;
}

export interface JWSRenewalInfoDecodedPayload {
  originalTransactionId: string;
  autoRenewProductId: string;
  productId: string;
  autoRenewStatus: 0 | 1;
  expirationIntent?: number;
  gracePeriodExpiresDate?: number;
  isInBillingRetryPeriod?: boolean;
  signedDate: number;
  environment: "Sandbox" | "Production";
}

/**
 * Apple's own classification for the last transaction of a subscription
 * group — see GetAllSubscriptionStatuses below. Preferred over deriving
 * status from expiresDate/autoRenewStatus by hand wherever Apple provides
 * it directly, since Apple's own accounting of grace periods, billing
 * retry, and revocation is authoritative (see the Phase report's "Apple
 * lifecycle mapping").
 */
export type AppleSubscriptionStatusCode = 1 | 2 | 3 | 4 | 5;

export interface AppleLastTransaction {
  originalTransactionId: string;
  status: AppleSubscriptionStatusCode;
  signedTransactionInfo: string;
  signedRenewalInfo?: string;
}

export interface AppleSubscriptionGroupStatus {
  subscriptionGroupIdentifier: string;
  lastTransactions: AppleLastTransaction[];
}

/** Abstraction point for tests — see subscriptionReconciliation.test.ts. Real implementation calls Apple's servers; nothing else does. */
export interface AppleStoreClient {
  /** GetAllSubscriptionStatuses — the authoritative current state for every transaction in the subscription's group. */
  getSubscriptionStatuses(transactionId: string): Promise<AppleSubscriptionGroupStatus[]>;
  verifyTransaction(signedTransactionInfo: string): Promise<JWSTransactionDecodedPayload>;
  verifyRenewalInfo(signedRenewalInfo: string): Promise<JWSRenewalInfoDecodedPayload>;
  verifyNotificationPayload<T>(signedPayload: string): Promise<T>;
}

class RealAppleStoreClient implements AppleStoreClient {
  async getSubscriptionStatuses(transactionId: string): Promise<AppleSubscriptionGroupStatus[]> {
    const apple = requireAppleBillingConfig();
    const token = await appStoreServerApiToken(apple);
    const response = await fetch(`${baseUrl(apple.environment)}/inApps/v1/subscriptions/${encodeURIComponent(transactionId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`App Store Server API request failed with status ${response.status}`);
    }
    const body = (await response.json()) as { data?: AppleSubscriptionGroupStatus[] };
    return body.data ?? [];
  }

  async verifyTransaction(signedTransactionInfo: string): Promise<JWSTransactionDecodedPayload> {
    const { payload } = await verifyAppleSignedPayload<JWSTransactionDecodedPayload>(signedTransactionInfo);
    return payload;
  }

  async verifyRenewalInfo(signedRenewalInfo: string): Promise<JWSRenewalInfoDecodedPayload> {
    const { payload } = await verifyAppleSignedPayload<JWSRenewalInfoDecodedPayload>(signedRenewalInfo);
    return payload;
  }

  async verifyNotificationPayload<T>(signedPayload: string): Promise<T> {
    const { payload } = await verifyAppleSignedPayload<T>(signedPayload);
    return payload;
  }
}

export const realAppleStoreClient: AppleStoreClient = new RealAppleStoreClient();
