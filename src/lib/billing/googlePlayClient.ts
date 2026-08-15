import { JWT } from "google-auth-library";
import { config } from "../config.js";

const ANDROID_PUBLISHER_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const API_BASE_URL = "https://androidpublisher.googleapis.com/androidpublisher/v3";

export interface GoogleBillingConfig {
  packageName: string;
  serviceAccountEmail: string;
  serviceAccountPrivateKey: string;
  proMonthlyProductId: string;
}

export function requireGoogleBillingConfig(): GoogleBillingConfig {
  const { GOOGLE_BILLING_ENABLED, GOOGLE_PLAY_PACKAGE_NAME, GOOGLE_BILLING_SERVICE_ACCOUNT_EMAIL, GOOGLE_BILLING_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64, GOOGLE_PRO_MONTHLY_PRODUCT_ID } = config;
  if (!GOOGLE_BILLING_ENABLED || !GOOGLE_PLAY_PACKAGE_NAME || !GOOGLE_BILLING_SERVICE_ACCOUNT_EMAIL || !GOOGLE_BILLING_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 || !GOOGLE_PRO_MONTHLY_PRODUCT_ID) {
    throw new Error("Google billing is not configured");
  }
  return {
    packageName: GOOGLE_PLAY_PACKAGE_NAME,
    serviceAccountEmail: GOOGLE_BILLING_SERVICE_ACCOUNT_EMAIL,
    serviceAccountPrivateKey: Buffer.from(GOOGLE_BILLING_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64, "base64").toString("utf8"),
    proMonthlyProductId: GOOGLE_PRO_MONTHLY_PRODUCT_ID,
  };
}

let cachedClient: { email: string; jwt: JWT } | null = null;

function authorizedClient(google: GoogleBillingConfig): JWT {
  if (cachedClient?.email === google.serviceAccountEmail) return cachedClient.jwt;
  const jwt = new JWT({ email: google.serviceAccountEmail, key: google.serviceAccountPrivateKey, scopes: [ANDROID_PUBLISHER_SCOPE] });
  cachedClient = { email: google.serviceAccountEmail, jwt };
  return jwt;
}

export type GoogleSubscriptionState =
  | "SUBSCRIPTION_STATE_PENDING"
  | "SUBSCRIPTION_STATE_ACTIVE"
  | "SUBSCRIPTION_STATE_CANCELED"
  | "SUBSCRIPTION_STATE_IN_GRACE_PERIOD"
  | "SUBSCRIPTION_STATE_ON_HOLD"
  | "SUBSCRIPTION_STATE_PAUSED"
  | "SUBSCRIPTION_STATE_EXPIRED"
  | "SUBSCRIPTION_STATE_REVOKED";

export interface GoogleSubscriptionLineItem {
  productId: string;
  expiryTime: string;
  autoRenewingPlan?: { autoRenewEnabled: boolean };
  offerDetails?: { basePlanId?: string; offerId?: string };
}

/** The androidpublisher v3 `purchases.subscriptionsv2.get` response — the authoritative current state Google itself tracks for a purchase token. */
export interface GoogleSubscriptionPurchaseV2 {
  kind?: string;
  startTime?: string;
  subscriptionState: GoogleSubscriptionState;
  latestOrderId?: string;
  lineItems: GoogleSubscriptionLineItem[];
  acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" | "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED";
  /** Present only for a licensing-tester/test purchase — never a real production entitlement. */
  testPurchase?: Record<string, never>;
}

/** Abstraction point for tests — see subscriptionReconciliation.test.ts. Real implementation calls Google's servers; nothing else does. */
export interface GooglePlayClient {
  getSubscriptionPurchaseV2(purchaseToken: string): Promise<GoogleSubscriptionPurchaseV2>;
  acknowledgeSubscription(productId: string, purchaseToken: string): Promise<void>;
}

async function authorizedFetch(google: GoogleBillingConfig, path: string, init?: RequestInit): Promise<Response> {
  const client = authorizedClient(google);
  const headers = await client.getRequestHeaders();
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: { ...headers, ...init?.headers } });
  return response;
}

class RealGooglePlayClient implements GooglePlayClient {
  async getSubscriptionPurchaseV2(purchaseToken: string): Promise<GoogleSubscriptionPurchaseV2> {
    const google = requireGoogleBillingConfig();
    const response = await authorizedFetch(
      google,
      `/applications/${encodeURIComponent(google.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`,
    );
    if (!response.ok) {
      throw new Error(`Play Developer API request failed with status ${response.status}`);
    }
    return (await response.json()) as GoogleSubscriptionPurchaseV2;
  }

  /**
   * Play Billing requires every subscription purchase to be acknowledged
   * within 3 days or it is automatically refunded — see the Phase report's
   * "Google acknowledgement strategy" for why this happens server-side,
   * immediately after a successful verify, rather than trusting mobile to
   * do it. Uses the v1 subscriptions.acknowledge endpoint (subscriptionsv2
   * has no acknowledge endpoint of its own); `productId` is the base
   * product/subscription ID from the verified purchase's line item, not a
   * client-supplied value.
   */
  async acknowledgeSubscription(productId: string, purchaseToken: string): Promise<void> {
    const google = requireGoogleBillingConfig();
    const response = await authorizedFetch(
      google,
      `/applications/${encodeURIComponent(google.packageName)}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
      { method: "POST" },
    );
    if (!response.ok) {
      throw new Error(`Play Developer API acknowledge request failed with status ${response.status}`);
    }
  }
}

export const realGooglePlayClient: GooglePlayClient = new RealGooglePlayClient();
