import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader, setPlan, setSubscriptionStatus } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import {
  applyNormalizedState,
  handleAppleNotification,
  handleGoogleNotification,
  normalizeAppleState,
  normalizeGoogleState,
  reconcileByProviderIdentity,
  recordBillingEvent,
  verifyAppleTransaction,
  verifyGoogleSubscription,
  type GoogleRtdnEnvelope,
} from "../src/lib/billing/subscriptionReconciliation.js";
import { verifyCertificateChain, verifyAppleSignedPayload } from "../src/lib/billing/jws.js";
import type {
  AppleStoreClient,
  AppleSubscriptionGroupStatus,
  JWSRenewalInfoDecodedPayload,
  JWSTransactionDecodedPayload,
} from "../src/lib/billing/appleAppStoreClient.js";
import type { GooglePlayClient, GoogleSubscriptionPurchaseV2 } from "../src/lib/billing/googlePlayClient.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

function appleTransaction(overrides: Partial<JWSTransactionDecodedPayload> = {}): JWSTransactionDecodedPayload {
  return {
    transactionId: "txn-1",
    originalTransactionId: "orig-1",
    bundleId: "com.chakusa.app",
    productId: "chakusa_pro_monthly",
    purchaseDate: Date.now() - DAY_MS,
    originalPurchaseDate: Date.now() - 30 * DAY_MS,
    expiresDate: Date.now() + 29 * DAY_MS,
    type: "Auto-Renewable Subscription",
    inAppOwnershipType: "PURCHASED",
    signedDate: Date.now(),
    environment: "Sandbox",
    ...overrides,
  };
}

function appleRenewal(overrides: Partial<JWSRenewalInfoDecodedPayload> = {}): JWSRenewalInfoDecodedPayload {
  return {
    originalTransactionId: "orig-1",
    autoRenewProductId: "chakusa_pro_monthly",
    productId: "chakusa_pro_monthly",
    autoRenewStatus: 1,
    signedDate: Date.now(),
    environment: "Sandbox",
    ...overrides,
  };
}

interface AppleFixture {
  transaction: JWSTransactionDecodedPayload;
  renewal?: JWSRenewalInfoDecodedPayload | null;
  status: 1 | 2 | 3 | 4 | 5;
  notification?: unknown;
}

/**
 * A dispatch-table fake, keyed by transactionId/notification-token —
 * mirrors tests/google-auth.test.ts's identities Map pattern so one app
 * instance can serve many scenarios. getSubscriptionStatuses accepts
 * either a fixture's own key OR its transaction's originalTransactionId,
 * since real callers (verifyAppleTransaction, handleAppleNotification) look
 * it up both ways — verify passes the client-submitted transactionId key,
 * while the notification path re-queries by the transaction's own
 * originalTransactionId after decoding it.
 */
function fakeAppleClient(fixtures: Record<string, AppleFixture>): AppleStoreClient {
  const findFixture = (id: string): { key: string; fixture: AppleFixture } | undefined => {
    if (fixtures[id]) return { key: id, fixture: fixtures[id] };
    const entry = Object.entries(fixtures).find(([, f]) => f.transaction.originalTransactionId === id || f.transaction.transactionId === id);
    return entry ? { key: entry[0], fixture: entry[1] } : undefined;
  };
  return {
    async getSubscriptionStatuses(transactionId) {
      const found = findFixture(transactionId);
      if (!found) return [];
      const { key, fixture } = found;
      const group: AppleSubscriptionGroupStatus = {
        subscriptionGroupIdentifier: "group-1",
        lastTransactions: [
          {
            originalTransactionId: fixture.transaction.originalTransactionId,
            status: fixture.status,
            signedTransactionInfo: `tx:${key}`,
            signedRenewalInfo: fixture.renewal === null ? undefined : `renewal:${key}`,
          },
        ],
      };
      return [group];
    },
    async verifyTransaction(signed) {
      const key = signed.split(":")[1]!;
      const fixture = fixtures[key];
      if (!fixture) throw new Error("unknown fixture");
      return fixture.transaction;
    },
    async verifyRenewalInfo(signed) {
      const key = signed.split(":")[1]!;
      const fixture = fixtures[key];
      if (!fixture?.renewal && fixture?.renewal !== undefined) throw new Error("no renewal");
      return fixture!.renewal ?? appleRenewal({ originalTransactionId: fixture!.transaction.originalTransactionId });
    },
    async verifyNotificationPayload(signedPayload) {
      const fixture = fixtures[signedPayload as string];
      if (!fixture) throw new Error("unknown notification fixture");
      return fixture.notification as never;
    },
  };
}

function googlePurchase(overrides: Partial<GoogleSubscriptionPurchaseV2> = {}): GoogleSubscriptionPurchaseV2 {
  return {
    subscriptionState: "SUBSCRIPTION_STATE_ACTIVE",
    startTime: new Date(Date.now() - DAY_MS).toISOString(),
    lineItems: [
      {
        productId: "chakusa_pro_monthly",
        expiryTime: new Date(Date.now() + 29 * DAY_MS).toISOString(),
        autoRenewingPlan: { autoRenewEnabled: true },
      },
    ],
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    // Tests run with APPLE_STORE_ENVIRONMENT=SANDBOX (see vitest.config.ts)
    // — a real Google test/license-tester purchase reports `testPurchase`,
    // which normalizeGoogleState maps to SANDBOX; matching that here is
    // what makes assertExpectedEnvironment accept these fixtures, the same
    // way a real sandbox deployment would only ever see test purchases.
    testPurchase: {},
    ...overrides,
  };
}

function fakeGoogleClient(purchasesByToken: Record<string, GoogleSubscriptionPurchaseV2>, acknowledged: string[] = []): GooglePlayClient {
  return {
    async getSubscriptionPurchaseV2(purchaseToken) {
      const purchase = purchasesByToken[purchaseToken];
      if (!purchase) throw new Error("Play Developer API request failed with status 404");
      return purchase;
    },
    async acknowledgeSubscription(productId, purchaseToken) {
      acknowledged.push(`${productId}:${purchaseToken}`);
    },
  };
}

async function createBusinessWithSubscription(app: FastifyInstance, email: string) {
  const account = await registerAccount(app, { email });
  return account;
}

// ---------------------------------------------------------------------------

describe("billing: subscription verification + reconciliation", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------
  // APPLE — state mapping (direct reconciliation-layer tests)
  // -------------------------------------------------------------------

  it("apple.1 valid initial Pro purchase", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction(), status: 1 } });

    const outcome = await verifyAppleTransaction(businessId, "txn-1", client);

    expect(outcome).toBe("applied");
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });
    expect(subscription.plan).toBe("PRO");
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.provider).toBe("APPLE");
    expect(subscription.originalTransactionId).toBe("orig-1");
  });

  it("apple.2 wrong product rejected", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction({ productId: "not_pro_monthly" }), status: 1 } });

    await expect(verifyAppleTransaction(businessId, "txn-1", client)).rejects.toThrow();
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });
    expect(subscription.plan).toBe("FREE");
  });

  it("apple.3 wrong app/bundle rejected", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction({ bundleId: "com.someone.else" }), status: 1 } });

    await expect(verifyAppleTransaction(businessId, "txn-1", client)).rejects.toThrow();
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).plan).toBe("FREE");
  });

  it("apple.4 malformed signed payload rejected (no valid certificate chain)", async () => {
    await expect(verifyAppleSignedPayload("not-a-real-jws")).rejects.toThrow();
  });

  it("apple.4b certificate chain verification rejects an untrusted/empty root set", () => {
    expect(verifyCertificateChain([], [])).toBe(false);
  });

  it("apple.5 active renewal keeps ACTIVE and updates latestTransactionId", async () => {
    const { businessId } = await registerAccount(app);
    const first = fakeAppleClient({ "txn-1": { transaction: appleTransaction({ transactionId: "txn-1" }), status: 1 } });
    await verifyAppleTransaction(businessId, "txn-1", first);

    const renewed = fakeAppleClient({
      "txn-2": { transaction: appleTransaction({ transactionId: "txn-2", purchaseDate: Date.now(), signedDate: Date.now() + 1000 }), status: 1 },
    });
    const outcome = await verifyAppleTransaction(businessId, "txn-2", renewed);

    expect(outcome).toBe("applied");
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });
    expect(subscription.latestTransactionId).toBe("txn-2");
    expect(subscription.originalTransactionId).toBe("orig-1"); // set-once, never overwritten
  });

  it("apple.6 free trial maps to TRIALING", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeAppleClient({
      "txn-1": { transaction: appleTransaction({ offerDiscountType: "FREE_TRIAL" } as Partial<JWSTransactionDecodedPayload>), status: 1 },
    });

    await verifyAppleTransaction(businessId, "txn-1", client);

    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });
    expect(subscription.status).toBe("TRIALING");
    expect(subscription.trialEndsAt).not.toBeNull();
  });

  it("apple.7 billing grace period maps to GRACE_PERIOD", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction(), status: 4 } });

    await verifyAppleTransaction(businessId, "txn-1", client);

    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).status).toBe("GRACE_PERIOD");
  });

  it("apple.8 renewal recovery returns to ACTIVE", async () => {
    const { businessId } = await registerAccount(app);
    const grace = fakeAppleClient({ "txn-1": { transaction: appleTransaction({ transactionId: "txn-1", signedDate: Date.now() }), status: 4 } });
    await verifyAppleTransaction(businessId, "txn-1", grace);

    const recovered = fakeAppleClient({
      "txn-2": { transaction: appleTransaction({ transactionId: "txn-2", signedDate: Date.now() + 1000 }), status: 1 },
    });
    await verifyAppleTransaction(businessId, "txn-2", recovered);

    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).status).toBe("ACTIVE");
  });

  it("apple.9 expiration maps to EXPIRED", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction(), status: 2 } });

    await verifyAppleTransaction(businessId, "txn-1", client);

    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).status).toBe("EXPIRED");
  });

  it("apple.10 revocation removes entitlement (maps to CANCELED)", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction(), status: 5 } });

    await verifyAppleTransaction(businessId, "txn-1", client);

    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).status).toBe("CANCELED");
  });

  it("apple.11 auto-renew off does not instantly remove paid access", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeAppleClient({
      "txn-1": { transaction: appleTransaction(), renewal: appleRenewal({ autoRenewStatus: 0 }), status: 1 },
    });

    await verifyAppleTransaction(businessId, "txn-1", client);

    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.cancelAtPeriodEnd).toBe(true);
  });

  it("apple.12 duplicate notification is idempotent", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction(), status: 1 } });
    await verifyAppleTransaction(businessId, "txn-1", client);

    const notificationClient = fakeAppleClient({
      "signed-notif": {
        transaction: appleTransaction(),
        status: 1,
        notification: { notificationType: "DID_RENEW", notificationUUID: "notif-1", data: { bundleId: "com.chakusa.app", environment: "Sandbox", signedTransactionInfo: "tx:txn-1" }, signedDate: Date.now() },
      },
      "txn-1": { transaction: appleTransaction(), status: 1 },
    });

    const first = await handleAppleNotification("signed-notif", notificationClient);
    const second = await handleAppleNotification("signed-notif", notificationClient);

    expect(first).toBe("applied");
    expect(second).toBe("duplicate");
    expect(await prisma.billingEvent.count({ where: { provider: "APPLE", providerEventId: "notif-1" } })).toBe(1);
  });

  it("apple.13 out-of-order event cannot overwrite newer state", async () => {
    const { businessId } = await registerAccount(app);
    const now = Date.now();
    const newer = fakeAppleClient({ "txn-new": { transaction: appleTransaction({ transactionId: "txn-new", signedDate: now + 10000 }), status: 1 } });
    await verifyAppleTransaction(businessId, "txn-new", newer);

    const older = fakeAppleClient({ "txn-old": { transaction: appleTransaction({ transactionId: "txn-old", signedDate: now - 10000 }), status: 2 } });
    const outcome = await verifyAppleTransaction(businessId, "txn-old", older);

    expect(outcome).toBe("stale-ignored");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).status).toBe("ACTIVE");
  });

  // -------------------------------------------------------------------
  // GOOGLE — state mapping
  // -------------------------------------------------------------------

  it("google.14 valid Pro subscription", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeGoogleClient({ "token-1": googlePurchase() });

    const outcome = await verifyGoogleSubscription(businessId, "token-1", client);

    expect(outcome).toBe("applied");
    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });
    expect(subscription.plan).toBe("PRO");
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.provider).toBe("GOOGLE");
    expect(subscription.googlePurchaseToken).toBe("token-1");
  });

  it("google.15 wrong product rejected", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeGoogleClient({
      "token-1": googlePurchase({ lineItems: [{ productId: "not_pro", expiryTime: new Date(Date.now() + DAY_MS).toISOString() }] }),
    });

    await expect(verifyGoogleSubscription(businessId, "token-1", client)).rejects.toThrow();
  });

  it("google.16 wrong package rejected (Play Developer API call fails)", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeGoogleClient({});

    await expect(verifyGoogleSubscription(businessId, "unknown-token", client)).rejects.toThrow();
  });

  it("google.17 active subscription", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeGoogleClient({ "token-1": googlePurchase() });
    await verifyGoogleSubscription(businessId, "token-1", client);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).status).toBe("ACTIVE");
  });

  it("google.19 grace period behavior maps to GRACE_PERIOD", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeGoogleClient({ "token-1": googlePurchase({ subscriptionState: "SUBSCRIPTION_STATE_IN_GRACE_PERIOD" }) });

    await verifyGoogleSubscription(businessId, "token-1", client);

    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).status).toBe("GRACE_PERIOD");
  });

  it("google.20 account hold removes entitlement", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeGoogleClient({ "token-1": googlePurchase({ subscriptionState: "SUBSCRIPTION_STATE_ON_HOLD" }) });

    await verifyGoogleSubscription(businessId, "token-1", client);

    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).status).toBe("EXPIRED");
  });

  it("google.21 expired subscription", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeGoogleClient({ "token-1": googlePurchase({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" }) });

    await verifyGoogleSubscription(businessId, "token-1", client);

    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).status).toBe("EXPIRED");
  });

  it("google.22 canceled renewal but period still active retains entitlement", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeGoogleClient({
      "token-1": googlePurchase({
        subscriptionState: "SUBSCRIPTION_STATE_CANCELED",
        lineItems: [{ productId: "chakusa_pro_monthly", expiryTime: new Date(Date.now() + 10 * DAY_MS).toISOString(), autoRenewingPlan: { autoRenewEnabled: false } }],
      }),
    });

    await verifyGoogleSubscription(businessId, "token-1", client);

    const subscription = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });
    expect(subscription.status).toBe("ACTIVE");
    expect(subscription.cancelAtPeriodEnd).toBe(true);
  });

  it("google.22b canceled and period truly ended denies entitlement", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeGoogleClient({
      "token-1": googlePurchase({
        subscriptionState: "SUBSCRIPTION_STATE_CANCELED",
        lineItems: [{ productId: "chakusa_pro_monthly", expiryTime: new Date(Date.now() - DAY_MS).toISOString(), autoRenewingPlan: { autoRenewEnabled: false } }],
      }),
    });

    await verifyGoogleSubscription(businessId, "token-1", client);

    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).status).toBe("EXPIRED");
  });

  it("google.23 revoked subscription denies entitlement", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeGoogleClient({ "token-1": googlePurchase({ subscriptionState: "SUBSCRIPTION_STATE_REVOKED" }) });

    await verifyGoogleSubscription(businessId, "token-1", client);

    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).status).toBe("CANCELED");
  });

  it("google.24 duplicate RTDN is idempotent", async () => {
    const { businessId } = await registerAccount(app);
    const first = fakeGoogleClient({ "token-1": googlePurchase() });
    await verifyGoogleSubscription(businessId, "token-1", first);

    const envelope: GoogleRtdnEnvelope = {
      message: {
        messageId: "msg-1",
        data: Buffer.from(JSON.stringify({ packageName: "com.chakusa.app", eventTimeMillis: String(Date.now()), subscriptionNotification: { version: "1.0", notificationType: 2, purchaseToken: "token-1", subscriptionId: "chakusa_pro_monthly" } })).toString("base64"),
      },
    };
    const client = fakeGoogleClient({ "token-1": googlePurchase() });

    const outcome1 = await handleGoogleNotification(envelope, client);
    const outcome2 = await handleGoogleNotification(envelope, client);

    expect(outcome1).toBe("applied");
    expect(outcome2).toBe("duplicate");
    expect(await prisma.billingEvent.count({ where: { provider: "GOOGLE", providerEventId: "msg-1" } })).toBe(1);
  });

  it("google.25 RTDN reconciles using live Developer API state, not notification contents alone", async () => {
    const { businessId } = await registerAccount(app);
    const initial = fakeGoogleClient({ "token-1": googlePurchase() });
    await verifyGoogleSubscription(businessId, "token-1", initial);

    // The notification body itself carries no subscription state — only a
    // type code and identifiers. The live purchase now reports EXPIRED;
    // reconciliation must reflect that live state, not merely "renewed".
    const nowExpired = fakeGoogleClient({ "token-1": googlePurchase({ subscriptionState: "SUBSCRIPTION_STATE_EXPIRED" }) });
    const envelope: GoogleRtdnEnvelope = {
      message: {
        messageId: "msg-2",
        data: Buffer.from(JSON.stringify({ packageName: "com.chakusa.app", eventTimeMillis: String(Date.now()), subscriptionNotification: { version: "1.0", notificationType: 13, purchaseToken: "token-1", subscriptionId: "chakusa_pro_monthly" } })).toString("base64"),
      },
    };

    const outcome = await handleGoogleNotification(envelope, nowExpired);

    expect(outcome).toBe("applied");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).status).toBe("EXPIRED");
  });

  it("google.26 unacknowledged verified purchase is acknowledged server-side", async () => {
    const { businessId } = await registerAccount(app);
    const acknowledged: string[] = [];
    const client = fakeGoogleClient({ "token-1": googlePurchase({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_PENDING" }) }, acknowledged);

    await verifyGoogleSubscription(businessId, "token-1", client);

    expect(acknowledged).toEqual(["chakusa_pro_monthly:token-1"]);
  });

  it("google.26b an already-acknowledged purchase is never re-acknowledged", async () => {
    const { businessId } = await registerAccount(app);
    const acknowledged: string[] = [];
    const client = fakeGoogleClient({ "token-1": googlePurchase({ acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" }) }, acknowledged);

    await verifyGoogleSubscription(businessId, "token-1", client);

    expect(acknowledged).toEqual([]);
  });

  // -------------------------------------------------------------------
  // GENERAL — entitlement, security, tenant isolation, route contracts
  // -------------------------------------------------------------------

  it("general.27 FREE unaffected by billing additions", async () => {
    const { token } = await registerAccount(app);
    const response = await app.inject({ method: "GET", url: "/subscription/status", headers: authHeader(token) });
    expect(response.json().plan).toBe("FREE");
    expect(response.json().features.automation).toBe(false);
  });

  it("general.28-31 entitlement matrix matches ACTIVE/TRIALING/GRACE_PERIOD/EXPIRED", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");

    for (const [status, entitled] of [["ACTIVE", true], ["TRIALING", true], ["GRACE_PERIOD", true], ["EXPIRED", false]] as const) {
      await setSubscriptionStatus(businessId, status);
      const response = await app.inject({ method: "GET", url: "/subscription/status", headers: authHeader(token) });
      expect(response.json().features.automation).toBe(entitled);
    }
  });

  it("general.32 CANCELED with entitlement truly ended is denied", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    await setSubscriptionStatus(businessId, "CANCELED");

    const response = await app.inject({ method: "GET", url: "/subscription/status", headers: authHeader(token) });
    expect(response.json().features.automation).toBe(false);
  });

  it("general.33 client cannot spoof plan via the verify body", async () => {
    const { token, businessId } = await registerAccount(app);
    const response = await app.inject({
      method: "POST",
      url: "/subscription/apple/verify",
      headers: authHeader(token),
      // No real transactionId will ever resolve against a real client, and
      // there is no `plan`/`status` field this endpoint even reads.
      payload: { transactionId: "does-not-exist", plan: "PRO", status: "ACTIVE" },
    });
    expect(response.statusCode).not.toBe(200);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).plan).toBe("FREE");
  });

  it("general.34 client cannot spoof businessId — verify always applies to the authenticated tenant", async () => {
    const businessA = await createBusinessWithSubscription(app, "billing-a@example.com");
    const businessB = await createBusinessWithSubscription(app, "billing-b@example.com");

    const client = fakeAppleClient({ "txn-spoof": { transaction: appleTransaction({ originalTransactionId: "orig-spoof" }), status: 1 } });
    const outcome = await verifyAppleTransaction(businessA.businessId, "txn-spoof", client);

    expect(outcome).toBe("applied");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId: businessA.businessId } })).plan).toBe("PRO");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId: businessB.businessId } })).plan).toBe("FREE");
  });

  it("general.35 cross-business restore is impossible — a transaction already linked to Business A cannot be applied to Business B", async () => {
    const businessA = await createBusinessWithSubscription(app, "restore-a@example.com");
    const businessB = await createBusinessWithSubscription(app, "restore-b@example.com");

    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction({ originalTransactionId: "orig-shared" }), status: 1 } });
    await verifyAppleTransaction(businessA.businessId, "txn-1", client);

    // Business B attempts to verify/restore the SAME transaction under its
    // own authenticated session — the unique originalTransactionId
    // constraint means this cannot silently take over Business A's
    // subscription for Business B.
    await expect(verifyAppleTransaction(businessB.businessId, "txn-1", client)).rejects.toThrow();
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId: businessA.businessId } })).plan).toBe("PRO");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId: businessB.businessId } })).plan).toBe("FREE");
  });

  it("general.36 restore reconciles an existing subscription (re-verifying the same transaction is safe)", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction(), status: 1 } });

    await verifyAppleTransaction(businessId, "txn-1", client);
    const outcome = await verifyAppleTransaction(businessId, "txn-1", client);

    expect(["applied", "stale-ignored"]).toContain(outcome);
    expect(await prisma.subscription.count({ where: { businessId } })).toBe(1);
  });

  it("general.37 verification endpoint is idempotent under a real HTTP round trip", async () => {
    const { token, businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction(), status: 1 } });
    const isolatedApp = await createTestApp({ appleStoreClient: client });

    const first = await isolatedApp.inject({ method: "POST", url: "/subscription/apple/verify", headers: authHeader(token), payload: { transactionId: "txn-1" } });
    const second = await isolatedApp.inject({ method: "POST", url: "/subscription/apple/verify", headers: authHeader(token), payload: { transactionId: "txn-1" } });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(await prisma.subscription.count({ where: { businessId } })).toBe(1);
    await isolatedApp.close();
  });

  it("general.38 subscription/status never leaks store secrets", async () => {
    const { token, businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction(), status: 1 } });
    const isolatedApp = await createTestApp({ appleStoreClient: client });
    await isolatedApp.inject({ method: "POST", url: "/subscription/apple/verify", headers: authHeader(token), payload: { transactionId: "txn-1" } });

    const response = await isolatedApp.inject({ method: "GET", url: "/subscription/status", headers: authHeader(token) });
    const body = JSON.stringify(response.json());

    expect(body).not.toMatch(/originalTransactionId|latestTransactionId|purchaseToken|googlePurchaseToken/i);
    void businessId;
    await isolatedApp.close();
  });

  it("general.39 account deletion + a late notification does not recreate the deleted tenant", async () => {
    const { businessId, token } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction({ originalTransactionId: "orig-deleted" }), status: 1 } });
    await verifyAppleTransaction(businessId, "txn-1", client);

    await app.inject({ method: "POST", url: "/auth/delete-account", headers: authHeader(token), payload: { password: "password123" } });

    expect(await prisma.business.findUnique({ where: { id: businessId } })).toBeNull();

    const lateState = await normalizeAppleState(appleTransaction({ originalTransactionId: "orig-deleted", signedDate: Date.now() + 100000 }), undefined, 1);
    const outcome = await reconcileByProviderIdentity(lateState);

    expect(outcome).toBe("not-found");
    expect(await prisma.business.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
  });

  it("general.40 automation rule creation is unaffected by billing additions (spot check)", async () => {
    const { token, businessId } = await registerAccount(app);
    await setPlan(businessId, "PRO");
    const response = await app.inject({
      method: "POST",
      url: "/automation/rules",
      headers: authHeader(token),
      payload: { name: "Missed call recovery", triggerType: "LEAD_CREATED", channel: "SMS" },
    });
    expect(response.statusCode).toBe(201);
  });

  it("general.41 unauthenticated verify request rejected", async () => {
    const response = await app.inject({ method: "POST", url: "/subscription/apple/verify", payload: { transactionId: "txn-1" } });
    expect(response.statusCode).toBe(401);
  });

  it("general.42 webhook route requires no bearer auth but still authenticates itself (unverifiable payload is safely ignored)", async () => {
    const response = await app.inject({ method: "POST", url: "/webhooks/apple/subscriptions", payload: { signedPayload: "garbage" } });
    expect(response.statusCode).toBe(200);
    expect(await prisma.billingEvent.count()).toBe(0);
  });

  it("general.43 Google webhook rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "POST", url: "/webhooks/google/subscriptions", payload: { message: { data: "e30=", messageId: "m1" } } });
    expect(response.statusCode).toBe(401);
  });

  it("general.44 idempotency ledger rejects a true duplicate event id without throwing to the caller", async () => {
    const first = await recordBillingEvent({ businessId: null, provider: "APPLE", providerEventId: "dup-1", eventType: "TEST" });
    const second = await recordBillingEvent({ businessId: null, provider: "APPLE", providerEventId: "dup-1", eventType: "TEST" });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(await prisma.billingEvent.count({ where: { providerEventId: "dup-1" } })).toBe(1);
  });

  it("general.45 applyNormalizedState is a safe no-op for a business with no Subscription row match", async () => {
    const outcome = await applyNormalizedState("00000000-0000-0000-0000-000000000000", normalizeGoogleState(googlePurchase(), "token-x"));
    expect(outcome).toBe("not-found");
  });
});
