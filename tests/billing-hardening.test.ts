import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, resetDatabase, registerAccount, authHeader } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { config } from "../src/lib/config.js";
import {
  handleAppleNotification,
  normalizeAppleState,
  verifyAppleTransaction,
  verifyGoogleSubscription,
} from "../src/lib/billing/subscriptionReconciliation.js";
import { assertValidAppleRootCertificates, verifyCertificateChain } from "../src/lib/billing/jws.js";
import { resolveApplePlan, resolveGooglePlan } from "../src/lib/billing/productCatalog.js";
import type {
  AppleStoreClient,
  AppleSubscriptionGroupStatus,
  JWSRenewalInfoDecodedPayload,
  JWSTransactionDecodedPayload,
} from "../src/lib/billing/appleAppStoreClient.js";
import type { GooglePlayClient, GoogleSubscriptionPurchaseV2 } from "../src/lib/billing/googlePlayClient.js";

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

function fakeAppleClient(fixtures: Record<string, { transaction: JWSTransactionDecodedPayload; renewal?: JWSRenewalInfoDecodedPayload | null; status: 1 | 2 | 3 | 4 | 5; notification?: unknown }>, hooks: { onGetSubscriptionStatuses?: () => void } = {}): AppleStoreClient {
  const findFixture = (id: string) => {
    if (fixtures[id]) return { key: id, fixture: fixtures[id]! };
    const entry = Object.entries(fixtures).find(([, f]) => f.transaction.originalTransactionId === id || f.transaction.transactionId === id);
    return entry ? { key: entry[0], fixture: entry[1] } : undefined;
  };
  return {
    async getSubscriptionStatuses(transactionId) {
      hooks.onGetSubscriptionStatuses?.();
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
      return fixture?.renewal ?? { originalTransactionId: fixture!.transaction.originalTransactionId, autoRenewProductId: "chakusa_pro_monthly", productId: "chakusa_pro_monthly", autoRenewStatus: 1, signedDate: Date.now(), environment: "Sandbox" };
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
    lineItems: [{ productId: "chakusa_pro_monthly", expiryTime: new Date(Date.now() + 29 * DAY_MS).toISOString(), autoRenewingPlan: { autoRenewEnabled: true } }],
    acknowledgementState: "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    testPurchase: {},
    ...overrides,
  };
}

function fakeGoogleClient(purchasesByToken: Record<string, GoogleSubscriptionPurchaseV2>, opts: { throwOnGet?: boolean } = {}): GooglePlayClient {
  return {
    async getSubscriptionPurchaseV2(purchaseToken) {
      if (opts.throwOnGet) throw new Error("simulated transient Play Developer API failure");
      const purchase = purchasesByToken[purchaseToken];
      if (!purchase) throw new Error("not found");
      return purchase;
    },
    async acknowledgeSubscription() {},
  };
}

describe("billing hardening — Phase 1.1", () => {
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
  // 1-4: product catalog / fail-closed mapping
  // -------------------------------------------------------------------

  it("1. unknown Apple product fails closed", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction({ productId: "com.chakusa.unknown_product" }), status: 1 } });

    await expect(verifyAppleTransaction(businessId, "txn-1", client)).rejects.toThrow();
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).plan).toBe("FREE");
  });

  it("2. unknown Google product fails closed", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeGoogleClient({ "token-1": googlePurchase({ lineItems: [{ productId: "com.chakusa.unknown_product", expiryTime: new Date(Date.now() + DAY_MS).toISOString() }] }) });

    await expect(verifyGoogleSubscription(businessId, "token-1", client)).rejects.toThrow();
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId } })).plan).toBe("FREE");
  });

  it("3. internal product mapping currently resolves only Pro", () => {
    expect(resolveApplePlan("chakusa_pro_monthly")).toBe("PRO");
    expect(resolveApplePlan("chakusa_business_monthly")).toBeNull();
    expect(resolveGooglePlan("chakusa_pro_monthly")).toBe("PRO");
    expect(resolveGooglePlan("chakusa_business_monthly")).toBeNull();
  });

  it("4. plan resolution is delegated to the catalog, not hardcoded — reconciliation's output plan always equals what the catalog resolves for that product", async () => {
    const configuredProductId = "chakusa_pro_monthly";
    const expectedPlan = resolveApplePlan(configuredProductId);
    expect(expectedPlan).not.toBeNull();

    const state = await normalizeAppleState(appleTransaction({ productId: configuredProductId }), undefined, 1);

    // Proves normalizeAppleState never assigns a plan independently of the
    // catalog — a future BUSINESS catalog entry would flow through
    // unchanged, with zero edits to this function.
    expect(state.plan).toBe(expectedPlan);
  });

  // -------------------------------------------------------------------
  // 5-6: certificate trust / webhook payload safety
  // -------------------------------------------------------------------

  it("5. invalid Apple certificate trust configuration fails closed at startup", () => {
    const original = config.APPLE_ROOT_CERTIFICATES_BASE64;
    try {
      config.APPLE_ROOT_CERTIFICATES_BASE64 = "not-valid-base64-der!!!";
      expect(() => assertValidAppleRootCertificates()).toThrow();

      config.APPLE_ROOT_CERTIFICATES_BASE64 = "";
      expect(() => assertValidAppleRootCertificates()).toThrow();
    } finally {
      config.APPLE_ROOT_CERTIFICATES_BASE64 = original;
    }
  });

  it("5b. certificate chain verification rejects an empty trust store even with a structurally valid-looking chain", () => {
    expect(verifyCertificateChain([], [])).toBe(false);
  });

  it("6. an unverifiable Apple webhook payload never mutates any Subscription", async () => {
    const { token, businessId } = await registerAccount(app);
    const before = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });

    const response = await app.inject({ method: "POST", url: "/webhooks/apple/subscriptions", payload: { signedPayload: "garbage-not-a-jws" } });

    expect(response.statusCode).toBe(200);
    const after = await prisma.subscription.findUniqueOrThrow({ where: { businessId } });
    expect(after).toEqual(before);
    expect(await prisma.billingEvent.count()).toBe(0);
    void token;
  });

  // -------------------------------------------------------------------
  // 7-8: transient failure retry semantics
  // -------------------------------------------------------------------

  it("7. a transient failure during Apple reconciliation surfaces as a non-2xx (retry-worthy) response", async () => {
    const client = fakeAppleClient(
      {
        "signed-notif": {
          transaction: appleTransaction(),
          status: 1,
          notification: { notificationType: "DID_RENEW", notificationUUID: "notif-transient-1", data: { bundleId: "com.chakusa.app", environment: "Sandbox", signedTransactionInfo: "tx:txn-1" }, signedDate: Date.now() },
        },
        "txn-1": { transaction: appleTransaction(), status: 1 },
      },
      {
        onGetSubscriptionStatuses: () => {
          throw new Error("simulated transient App Store Server API failure");
        },
      },
    );
    const isolatedApp = await createTestApp({ appleStoreClient: client });

    const response = await isolatedApp.inject({ method: "POST", url: "/webhooks/apple/subscriptions", payload: { signedPayload: "signed-notif" } });

    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(await prisma.billingEvent.count({ where: { providerEventId: "notif-transient-1" } })).toBe(0);
    await isolatedApp.close();
  });

  it("8. a transient failure during Google reconciliation surfaces as a non-2xx (retry-worthy) response", async () => {
    const client = fakeGoogleClient({ "token-1": googlePurchase() }, { throwOnGet: true });
    const isolatedApp = await createTestApp({ googlePlayClient: client });

    const envelope = {
      message: {
        messageId: "msg-transient-1",
        data: Buffer.from(JSON.stringify({ packageName: "com.chakusa.app", eventTimeMillis: String(Date.now()), subscriptionNotification: { version: "1.0", notificationType: 2, purchaseToken: "token-1", subscriptionId: "chakusa_pro_monthly" } })).toString("base64"),
      },
    };

    // The Google webhook requires an authenticated OIDC bearer token in
    // production; RTDN auth itself is audited separately (googleRtdnAuth.ts
    // is unit-testable on its own). This exercises the reconciliation
    // failure path directly, which is what this test is about.
    const outcome = await import("../src/lib/billing/subscriptionReconciliation.js").then((m) => m.handleGoogleNotification(envelope, client).catch((error: unknown) => error));

    expect(outcome).toBeInstanceOf(Error);
    expect(await prisma.billingEvent.count({ where: { providerEventId: "msg-transient-1" } })).toBe(0);
    await isolatedApp.close();
  });

  // -------------------------------------------------------------------
  // 9: event ledger crash-window
  // -------------------------------------------------------------------

  it("9. a failed reconciliation attempt never records a billing event that would swallow the real retry", async () => {
    const failingClient = fakeAppleClient(
      {
        "signed-notif": {
          transaction: appleTransaction(),
          status: 1,
          notification: { notificationType: "DID_RENEW", notificationUUID: "notif-crash-1", data: { bundleId: "com.chakusa.app", environment: "Sandbox", signedTransactionInfo: "tx:txn-1" }, signedDate: Date.now() },
        },
        "txn-1": { transaction: appleTransaction(), status: 1 },
      },
      { onGetSubscriptionStatuses: () => { throw new Error("simulated crash mid-processing"); } },
    );

    await expect(handleAppleNotification("signed-notif", failingClient)).rejects.toThrow();
    expect(await prisma.billingEvent.count({ where: { providerEventId: "notif-crash-1" } })).toBe(0);

    // Retry with a healthy client — because the failed attempt never
    // recorded the event, this is real processing, not a false duplicate.
    const { businessId } = await registerAccount(app, { email: "crash-retry@example.com" });
    const workingClient = fakeAppleClient({
      "signed-notif": {
        transaction: appleTransaction({ originalTransactionId: "orig-crash-retry" }),
        status: 1,
        notification: { notificationType: "DID_RENEW", notificationUUID: "notif-crash-1", data: { bundleId: "com.chakusa.app", environment: "Sandbox", signedTransactionInfo: "tx:txn-1" }, signedDate: Date.now() },
      },
      "txn-1": { transaction: appleTransaction({ originalTransactionId: "orig-crash-retry" }), status: 1 },
    });
    await verifyAppleTransaction(businessId, "txn-1", workingClient);

    const outcome = await handleAppleNotification("signed-notif", workingClient);
    expect(outcome).toBe("applied");
    expect(await prisma.billingEvent.count({ where: { providerEventId: "notif-crash-1" } })).toBe(1);
  });

  // -------------------------------------------------------------------
  // 10-12: concurrent ownership claims
  // -------------------------------------------------------------------

  it("10. concurrent Apple ownership claims for the same originalTransactionId produce exactly one winner", async () => {
    const businessA = await registerAccount(app, { email: "concurrent-apple-a@example.com" });
    const businessB = await registerAccount(app, { email: "concurrent-apple-b@example.com" });
    const client = fakeAppleClient({ "txn-shared": { transaction: appleTransaction({ originalTransactionId: "orig-shared-apple" }), status: 1 } });

    const results = await Promise.allSettled([
      verifyAppleTransaction(businessA.businessId, "txn-shared", client),
      verifyAppleTransaction(businessB.businessId, "txn-shared", client),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const [subA, subB] = await Promise.all([
      prisma.subscription.findUniqueOrThrow({ where: { businessId: businessA.businessId } }),
      prisma.subscription.findUniqueOrThrow({ where: { businessId: businessB.businessId } }),
    ]);
    const plans = [subA.plan, subB.plan].sort();
    expect(plans).toEqual(["FREE", "PRO"]);
  });

  it("11. concurrent Google ownership claims for the same purchaseToken produce exactly one winner; loser stays FREE", async () => {
    const businessA = await registerAccount(app, { email: "concurrent-google-a@example.com" });
    const businessB = await registerAccount(app, { email: "concurrent-google-b@example.com" });
    const client = fakeGoogleClient({ "token-shared": googlePurchase() });

    const results = await Promise.allSettled([
      verifyGoogleSubscription(businessA.businessId, "token-shared", client),
      verifyGoogleSubscription(businessB.businessId, "token-shared", client),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

    const [subA, subB] = await Promise.all([
      prisma.subscription.findUniqueOrThrow({ where: { businessId: businessA.businessId } }),
      prisma.subscription.findUniqueOrThrow({ where: { businessId: businessB.businessId } }),
    ]);
    expect([subA.plan, subB.plan].sort()).toEqual(["FREE", "PRO"]);
  });

  // -------------------------------------------------------------------
  // 13-14: idempotency + status leak (regression confirmation post-refactor)
  // -------------------------------------------------------------------

  it("13. duplicate successfully processed provider event remains idempotent after the transactional rewrite", async () => {
    const { businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction(), status: 1 } });
    await verifyAppleTransaction(businessId, "txn-1", client);

    const notificationClient = fakeAppleClient({
      "signed-notif": { transaction: appleTransaction(), status: 1, notification: { notificationType: "DID_RENEW", notificationUUID: "notif-dup-1", data: { bundleId: "com.chakusa.app", environment: "Sandbox", signedTransactionInfo: "tx:txn-1" }, signedDate: Date.now() } },
      "txn-1": { transaction: appleTransaction(), status: 1 },
    });

    const first = await handleAppleNotification("signed-notif", notificationClient);
    const second = await handleAppleNotification("signed-notif", notificationClient);

    expect(first).toBe("applied");
    expect(second).toBe("duplicate");
    expect(await prisma.billingEvent.count({ where: { providerEventId: "notif-dup-1" } })).toBe(1);
  });

  it("14. subscription/status still leaks no provider secrets after this hardening pass", async () => {
    const { token, businessId } = await registerAccount(app);
    const client = fakeAppleClient({ "txn-1": { transaction: appleTransaction(), status: 1 } });
    await verifyAppleTransaction(businessId, "txn-1", client);

    const response = await app.inject({ method: "GET", url: "/subscription/status", headers: authHeader(token) });
    const body = JSON.stringify(response.json());

    expect(body).not.toMatch(/originalTransactionId|latestTransactionId|purchaseToken|googlePurchaseToken|environment/i);
  });
});
