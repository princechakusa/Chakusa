import { Prisma, type Plan, type SubscriptionEnvironment, type SubscriptionProvider, type SubscriptionStatus } from "@prisma/client";
import { prisma } from "../prisma.js";
import { ApiError } from "../errors.js";
import { config } from "../config.js";
import {
  requireAppleBillingConfig,
  type AppleStoreClient,
  type JWSRenewalInfoDecodedPayload,
  type JWSTransactionDecodedPayload,
} from "./appleAppStoreClient.js";
import { requireGoogleBillingConfig, type GooglePlayClient, type GoogleSubscriptionPurchaseV2 } from "./googlePlayClient.js";
import { resolveApplePlan, resolveGooglePlan } from "./productCatalog.js";

type DatabaseClient = typeof prisma | Prisma.TransactionClient;

/**
 * The single normalized shape both Apple and Google state gets reduced to
 * before touching the database — everything downstream of this point
 * (applyNormalizedState) is provider-agnostic. `effectiveAt` is the
 * provider's own timestamp for this snapshot (Apple's transaction/renewal
 * `signedDate`; for Google, the moment this fresh API response was
 * received, since subscriptionsv2 is always a live re-query rather than a
 * cached notification payload) — see Subscription.providerEventAt's doc
 * comment for why this, not `updatedAt`, is the event-ordering guard.
 */
export interface NormalizedSubscriptionState {
  plan: Plan;
  status: SubscriptionStatus;
  provider: SubscriptionProvider;
  providerProductId: string;
  environment: SubscriptionEnvironment;
  originalTransactionId?: string;
  latestTransactionId?: string;
  googlePurchaseToken?: string;
  currentPeriodStart?: Date;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd: boolean;
  trialEndsAt?: Date;
  effectiveAt: Date;
}

// ---------------------------------------------------------------------------
// Apple: GetAllSubscriptionStatuses -> NormalizedSubscriptionState
// ---------------------------------------------------------------------------

/**
 * Apple's own per-transaction classification (see appleAppStoreClient.ts) —
 * the authoritative source for whether entitlement is currently active,
 * preferred over re-deriving it from expiresDate by hand. 3 (billing retry,
 * no grace period configured/active) and 5 (revoked) are NOT entitled; see
 * the Phase report's "Apple lifecycle mapping" for the full table.
 */
function mapAppleStatus(
  code: 1 | 2 | 3 | 4 | 5,
  transaction: JWSTransactionDecodedPayload,
): SubscriptionStatus {
  if (code === 4) return "GRACE_PERIOD";
  if (code === 5) return "CANCELED"; // revoked — refund/chargeback, entitlement ended for cause
  if (code === 2 || code === 3) return "EXPIRED";
  // code === 1 (active)
  const isFreeTrial = (transaction as { offerDiscountType?: string }).offerDiscountType === "FREE_TRIAL";
  return isFreeTrial ? "TRIALING" : "ACTIVE";
}

export async function normalizeAppleState(
  transaction: JWSTransactionDecodedPayload,
  renewalInfo: JWSRenewalInfoDecodedPayload | undefined,
  statusCode: 1 | 2 | 3 | 4 | 5,
): Promise<NormalizedSubscriptionState> {
  const apple = requireAppleBillingConfig();

  if (transaction.bundleId !== apple.bundleId) {
    throw ApiError.badRequest("Transaction does not belong to this app");
  }
  // Resolves against the approved product catalog, not a bare existence
  // check — an unrecognized productId fails closed (null) rather than ever
  // defaulting to PRO. See productCatalog.ts's doc comment for why this is
  // also what lets a future BUSINESS product be added without touching
  // this function.
  const plan = resolveApplePlan(transaction.productId);
  if (!plan) {
    throw ApiError.badRequest("Transaction is not for a Chakusa product this server recognizes");
  }

  const status = mapAppleStatus(statusCode, transaction);
  const environment: SubscriptionEnvironment = transaction.environment === "Production" ? "PRODUCTION" : "SANDBOX";
  const effectiveAt = new Date(Math.max(transaction.signedDate, renewalInfo?.signedDate ?? 0));

  return {
    plan,
    status,
    provider: "APPLE",
    providerProductId: transaction.productId,
    environment,
    originalTransactionId: transaction.originalTransactionId,
    latestTransactionId: transaction.transactionId,
    currentPeriodStart: new Date(transaction.purchaseDate),
    currentPeriodEnd: transaction.expiresDate ? new Date(transaction.expiresDate) : undefined,
    cancelAtPeriodEnd: renewalInfo ? renewalInfo.autoRenewStatus === 0 : false,
    trialEndsAt: status === "TRIALING" && transaction.expiresDate ? new Date(transaction.expiresDate) : undefined,
    effectiveAt,
  };
}

// ---------------------------------------------------------------------------
// Google: subscriptionsv2.get -> NormalizedSubscriptionState
// ---------------------------------------------------------------------------

/**
 * See the Phase report's "Google lifecycle mapping" for the full table.
 * ON_HOLD (account hold) and PAUSED deliberately do NOT retain entitlement
 * — only ACTIVE, IN_GRACE_PERIOD, and a not-yet-expired CANCELED do.
 * PENDING (e.g. an unresolved cash-payment purchase) is treated as
 * not-yet-entitled; Chakusa's SubscriptionStatus enum has no direct
 * equivalent, so it maps to EXPIRED (a documented limitation — see the
 * Phase report).
 */
function mapGoogleStatus(purchase: GoogleSubscriptionPurchaseV2, expiryTime: Date, now: Date): SubscriptionStatus {
  switch (purchase.subscriptionState) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      return "ACTIVE";
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      return "GRACE_PERIOD";
    case "SUBSCRIPTION_STATE_CANCELED":
      return expiryTime > now ? "ACTIVE" : "EXPIRED";
    case "SUBSCRIPTION_STATE_REVOKED":
      return "CANCELED";
    case "SUBSCRIPTION_STATE_ON_HOLD":
    case "SUBSCRIPTION_STATE_PAUSED":
    case "SUBSCRIPTION_STATE_EXPIRED":
    case "SUBSCRIPTION_STATE_PENDING":
    default:
      return "EXPIRED";
  }
}

export function normalizeGoogleState(purchase: GoogleSubscriptionPurchaseV2, purchaseToken: string, now: Date = new Date()): NormalizedSubscriptionState {
  requireGoogleBillingConfig();

  // Resolves each line item's productId against the approved catalog
  // (never a bare "does the product exist" check) and takes the first
  // recognized one — see normalizeAppleState's identical reasoning and
  // productCatalog.ts's doc comment.
  const lineItem = purchase.lineItems
    .map((item) => ({ item, plan: resolveGooglePlan(item.productId) }))
    .find((entry) => entry.plan !== null);
  if (!lineItem) {
    throw ApiError.badRequest("Purchase is not for a Chakusa product this server recognizes");
  }

  const expiryTime = new Date(lineItem.item.expiryTime);
  const status = mapGoogleStatus(purchase, expiryTime, now);
  const environment: SubscriptionEnvironment = purchase.testPurchase ? "SANDBOX" : "PRODUCTION";

  return {
    plan: lineItem.plan!,
    status,
    provider: "GOOGLE",
    providerProductId: lineItem.item.productId,
    environment,
    googlePurchaseToken: purchaseToken,
    currentPeriodStart: purchase.startTime ? new Date(purchase.startTime) : undefined,
    currentPeriodEnd: expiryTime,
    cancelAtPeriodEnd: lineItem.item.autoRenewingPlan?.autoRenewEnabled === false,
    // See this function's doc comment — Google's subscriptionsv2 response
    // has no first-class trial signal this backend can rely on; TRIALING is
    // never derived for Google in v1 (ACTIVE still grants full entitlement).
    trialEndsAt: undefined,
    effectiveAt: now,
  };
}

// ---------------------------------------------------------------------------
// Apply — tenant-scoped, idempotent, event-ordering-safe
// ---------------------------------------------------------------------------

export type ReconcileOutcome = "applied" | "stale-ignored" | "not-found";

function subscriptionEventType(existing: { plan: Plan; status: SubscriptionStatus }, next: NormalizedSubscriptionState): "TRIAL_STARTED" | "TRIAL_EXPIRED" | "TRIAL_CONVERTED" | "SUBSCRIPTION_STARTED" | "UPGRADE" | "DOWNGRADE" | "CANCELLATION" | "GRACE_PERIOD" | "REACTIVATION" | "EXPIRATION" | null {
  if (existing.status === "TRIALING" && next.status === "ACTIVE") return "TRIAL_CONVERTED";
  if (existing.status !== "TRIALING" && next.status === "TRIALING") return "TRIAL_STARTED";
  if (existing.status !== "EXPIRED" && next.status === "EXPIRED") return "EXPIRATION";
  if (existing.status !== "CANCELED" && next.status === "CANCELED") return "CANCELLATION";
  if (existing.status !== "GRACE_PERIOD" && next.status === "GRACE_PERIOD") return "GRACE_PERIOD";
  if (["EXPIRED", "CANCELED"].includes(existing.status) && next.status === "ACTIVE") return "REACTIVATION";
  if (existing.plan !== next.plan) return ["FREE", "PRO", "BUSINESS"].indexOf(next.plan) > ["FREE", "PRO", "BUSINESS"].indexOf(existing.plan) ? "UPGRADE" : "DOWNGRADE";
  if (existing.plan === "FREE" && next.plan !== "FREE") return "SUBSCRIPTION_STARTED";
  return null;
}

/**
 * The one place a NormalizedSubscriptionState is ever written to the
 * database. Tenant-scoped by an explicit `businessId` the caller must have
 * already resolved (from authenticated request context for a verify call,
 * or by looking up the existing Subscription row by provider identity for
 * a webhook — see reconcileByProviderIdentity below); never accepts one
 * from provider payload contents.
 *
 * Event-ordering guard: if this business already has a reconciled snapshot
 * newer than `state.effectiveAt`, the incoming state is ignored rather than
 * applied — a delayed/out-of-order webhook can never regress newer state.
 */
export async function applyNormalizedState(
  businessId: string,
  state: NormalizedSubscriptionState,
  db: DatabaseClient = prisma,
): Promise<ReconcileOutcome> {
  const existing = await db.subscription.findUnique({ where: { businessId } });
  if (!existing) return "not-found";

  if (existing.providerEventAt && existing.providerEventAt > state.effectiveAt) {
    return "stale-ignored";
  }

  try {
    await db.subscription.update({
      where: { businessId },
      data: {
        plan: state.plan,
        status: state.status,
        provider: state.provider,
        providerProductId: state.providerProductId,
        environment: state.environment,
        // originalTransactionId is set-once (see the schema doc comment) —
        // never overwritten by a later reconciliation for the same business.
        originalTransactionId: existing.originalTransactionId ?? state.originalTransactionId,
        latestTransactionId: state.latestTransactionId ?? existing.latestTransactionId,
        googlePurchaseToken: state.googlePurchaseToken ?? existing.googlePurchaseToken,
        currentPeriodStart: state.currentPeriodStart ?? existing.currentPeriodStart,
        currentPeriodEnd: state.currentPeriodEnd ?? existing.currentPeriodEnd,
        cancelAtPeriodEnd: state.cancelAtPeriodEnd,
        trialEndsAt: state.trialEndsAt ?? null,
        providerEventAt: state.effectiveAt,
      },
    });
    const eventType = subscriptionEventType(existing, state);
    if (eventType) {
      await db.subscriptionEvent.create({ data: { businessId, type: eventType, provider: state.provider, fromPlan: existing.plan, toPlan: state.plan, fromStatus: existing.status, toStatus: state.status, effectiveAt: state.effectiveAt } });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Two businesses raced to claim the same originalTransactionId/
      // googlePurchaseToken — Postgres's unique index on Subscription is
      // the actual authority here (see the schema doc comments), not any
      // application-level check-then-write. Exactly one caller's UPDATE
      // can ever succeed; the loser's write makes zero changes to its own
      // row (a failed UPDATE is fully atomic — nothing partial is ever
      // persisted), so it never inherits PRO. Surfaced as a clear 409
      // rather than a raw database error, matching this codebase's
      // existing P2002-to-409 convention.
      throw ApiError.conflict("This transaction/purchase is already linked to a different Chakusa account");
    }
    throw error;
  }
  return "applied";
}

/**
 * Webhook entry point: resolves the owning business purely from the
 * provider's own reconciliation identity (originalTransactionId for Apple,
 * purchaseToken for Google) — never from anything in the notification body
 * that claims to be a Chakusa identifier. Returns "not-found" (a safe
 * no-op, not an error) when no Subscription row carries that identity —
 * covers both "this purchase was never verified through Chakusa" and "the
 * owning account was since deleted" identically, which is exactly the
 * behavior that prevents a late notification from ever recreating a
 * deleted business — see the Phase report's "account deletion" section.
 */
export async function reconcileByProviderIdentity(state: NormalizedSubscriptionState, db: DatabaseClient = prisma): Promise<ReconcileOutcome> {
  const where =
    state.provider === "APPLE"
      ? { originalTransactionId: state.originalTransactionId }
      : { googlePurchaseToken: state.googlePurchaseToken };
  if (!where.originalTransactionId && !where.googlePurchaseToken) return "not-found";

  const existing = await db.subscription.findFirst({ where });
  if (!existing) return "not-found";

  return applyNormalizedState(existing.businessId, state, db);
}

// ---------------------------------------------------------------------------
// BillingEvent idempotency ledger
// ---------------------------------------------------------------------------

export interface RecordBillingEventInput {
  businessId: string | null;
  provider: SubscriptionProvider;
  providerEventId: string;
  eventType: string;
  transactionId?: string;
  purchaseToken?: string;
}

/**
 * Returns `false` (and writes nothing) when (provider, providerEventId) was
 * already recorded — the unique constraint is the actual guarantee, not a
 * prior SELECT (which would leave a race window); a duplicate provider
 * retry or a re-sent verify request is expected, normal, and must never
 * throw or duplicate a row. Callers check the return value to decide
 * whether to skip re-applying state.
 *
 * Uses `createMany` + `skipDuplicates` rather than `create` + catch-P2002
 * deliberately: this function is called from inside the same database
 * transaction as the entitlement mutation it guards (see
 * handleAppleNotification/handleGoogleNotification below and the Phase 1.1
 * report's "event ledger crash window" section) — a `create()` that throws
 * on conflict would poison that transaction in Postgres (any error inside
 * a transaction aborts it, even if the application catches it), which
 * would incorrectly fail the whole request instead of just this insert.
 * `skipDuplicates` never raises an error for a conflict, so it stays safe
 * to call inside a transaction whose outcome the caller still controls.
 */
export async function recordBillingEvent(input: RecordBillingEventInput, db: DatabaseClient = prisma): Promise<boolean> {
  const result = await db.billingEvent.createMany({
    data: [
      {
        businessId: input.businessId,
        provider: input.provider,
        providerEventId: input.providerEventId,
        eventType: input.eventType,
        transactionId: input.transactionId,
        purchaseToken: input.purchaseToken,
        processedAt: new Date(),
      },
    ],
    skipDuplicates: true,
  });
  return result.count === 1;
}

// ---------------------------------------------------------------------------
// High-level verify flows — used by the authenticated POST /subscription/*/verify routes
// ---------------------------------------------------------------------------

/**
 * Re-queries Apple's GetAllSubscriptionStatuses for the given transaction
 * rather than trusting only a client-submitted transaction payload — this
 * is what makes the flow "verification," not "parsing." Rejects (400) if
 * no entry in the response actually matches the expected product; a
 * transaction that merely parses is never sufficient (see the Phase
 * report's "server is the source of truth" section).
 */
/**
 * A transaction/purchase whose own reported environment doesn't match this
 * deployment's configured APPLE_STORE_ENVIRONMENT is rejected outright — a
 * production deployment must never grant real entitlement from a tester's
 * sandbox purchase (or vice versa). See config.ts's APPLE_STORE_ENVIRONMENT
 * doc comment and the Phase report's "sandbox/production separation"
 * section. Provider-agnostic: applies identically to Apple and Google,
 * keyed off the same APPLE_STORE_ENVIRONMENT setting (one Chakusa
 * deployment targets one environment at a time for both stores).
 */
function assertExpectedEnvironment(state: NormalizedSubscriptionState): void {
  if (state.environment !== config.APPLE_STORE_ENVIRONMENT) {
    throw ApiError.badRequest("This transaction's store environment does not match the server's configured environment");
  }
}

export async function verifyAppleTransaction(
  businessId: string,
  transactionId: string,
  client: AppleStoreClient,
): Promise<ReconcileOutcome> {
  const groups = await client.getSubscriptionStatuses(transactionId);

  for (const group of groups) {
    for (const last of group.lastTransactions) {
      const transaction = await client.verifyTransaction(last.signedTransactionInfo);
      // Catalog-driven, not a literal Pro-only comparison — see
      // productCatalog.ts. Any product this server doesn't recognize at all
      // is skipped here (not the entry that ultimately fails the request);
      // normalizeAppleState below is still the actual fail-closed boundary
      // if every candidate is unrecognized.
      if (!resolveApplePlan(transaction.productId)) continue;
      const renewalInfo = last.signedRenewalInfo ? await client.verifyRenewalInfo(last.signedRenewalInfo) : undefined;
      const state = await normalizeAppleState(transaction, renewalInfo, last.status);
      assertExpectedEnvironment(state);
      return applyNormalizedState(businessId, state, prisma);
    }
  }
  throw ApiError.badRequest("No Chakusa Pro subscription was found for this transaction");
}

export async function verifyGoogleSubscription(businessId: string, purchaseToken: string, client: GooglePlayClient): Promise<ReconcileOutcome> {
  const purchase = await client.getSubscriptionPurchaseV2(purchaseToken);
  const state = normalizeGoogleState(purchase, purchaseToken);
  assertExpectedEnvironment(state);
  const outcome = await applyNormalizedState(businessId, state, prisma);

  // Server-side acknowledgement, immediately after a successful verified
  // apply — see googlePlayClient.ts's acknowledgeSubscription doc comment
  // for why this happens here rather than trusting mobile to do it.
  // Never acknowledges a purchase this backend hasn't itself just verified.
  if (outcome === "applied" && purchase.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
    await client.acknowledgeSubscription(state.providerProductId, purchaseToken);
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// Webhook flows — App Store Server Notifications V2 / Play RTDN
// ---------------------------------------------------------------------------

export interface AppleServerNotificationV2Payload {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  data?: {
    bundleId: string;
    environment: "Sandbox" | "Production";
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
  };
  signedDate: number;
}

export type WebhookOutcome = "applied" | "stale-ignored" | "not-found" | "duplicate" | "invalid";

/**
 * Apple's own signed notification body is deliberately treated as only a
 * pointer to "something changed for this originalTransactionId," not as
 * authoritative state on its own — after verifying and decoding it, this
 * re-queries GetAllSubscriptionStatuses (the same live call verifyAppleTransaction
 * makes) for the current truth, so a delayed or out-of-order notification
 * can never apply a stale snapshot on top of newer reality. See the Phase
 * report's "event ordering protection" section.
 *
 * Retry-safety contract (see the Phase 1.1 report's "Apple webhook retry
 * semantics" section): only signature/authentication failure is caught
 * here and reported as `"invalid"` — that payload will never become valid
 * on retry, so the caller (webhooks.routes.ts) acknowledges it with 200.
 * Everything after that point is allowed to throw normally: a transient DB
 * or network failure must surface as a thrown error so the route returns a
 * non-2xx and Apple retries, rather than this function silently swallowing
 * it into a false "delivered" acknowledgement.
 *
 * EVENT LEDGER CRASH WINDOW (Phase 1.1 hardening — read before reordering
 * anything below): every external call (client.verifyTransaction,
 * client.getSubscriptionStatuses, client.verifyRenewalInfo) happens FIRST,
 * fully resolving `state` in memory, before touching the database at all —
 * this codebase's established discipline is to never call out over the
 * network from inside a DB transaction (see feedback.service.ts). Only
 * once `state` is known are recordBillingEvent and applyNormalizedState
 * run together inside a single prisma.$transaction, so a crash between
 * "the idempotency marker committed" and "the Subscription mutation
 * committed" is now structurally impossible — they commit atomically or
 * not at all, and a redelivered notification after a crash re-enters this
 * function and does real work again instead of hitting a false duplicate.
 */
export async function handleAppleNotification(signedPayload: string, client: AppleStoreClient): Promise<WebhookOutcome> {
  let notification: AppleServerNotificationV2Payload;
  try {
    notification = await client.verifyNotificationPayload<AppleServerNotificationV2Payload>(signedPayload);
  } catch {
    return "invalid";
  }

  // All external/network resolution happens before any database write —
  // `state` stays undefined if there's nothing to reconcile (no embedded
  // transaction, no matching group, or a store-environment mismatch).
  let state: NormalizedSubscriptionState | undefined;
  const signedTransactionInfo = notification.data?.signedTransactionInfo;
  if (signedTransactionInfo) {
    const transaction = await client.verifyTransaction(signedTransactionInfo);
    const groups = await client.getSubscriptionStatuses(transaction.originalTransactionId);
    outer: for (const group of groups) {
      for (const last of group.lastTransactions) {
        if (last.originalTransactionId !== transaction.originalTransactionId) continue;
        const freshTransaction = await client.verifyTransaction(last.signedTransactionInfo);
        const renewalInfo = last.signedRenewalInfo ? await client.verifyRenewalInfo(last.signedRenewalInfo) : undefined;
        state = await normalizeAppleState(freshTransaction, renewalInfo, last.status);
        break outer;
      }
    }
    if (state && !appleEnvironmentMatchesDeployment(state)) state = undefined;
  }

  return prisma.$transaction(async (tx) => {
    const recorded = await recordBillingEvent(
      { businessId: null, provider: "APPLE", providerEventId: notification.notificationUUID, eventType: notification.notificationType },
      tx,
    );
    if (!recorded) return "duplicate";
    if (!state) return "not-found";
    return reconcileByProviderIdentity(state, tx);
  });
}

function appleEnvironmentMatchesDeployment(state: NormalizedSubscriptionState): boolean {
  return state.environment === config.APPLE_STORE_ENVIRONMENT;
}

export interface GoogleRtdnEnvelope {
  message: { data: string; messageId: string; publishTime?: string };
  subscription?: string;
}

interface GoogleRtdnDecodedData {
  packageName: string;
  eventTimeMillis: string;
  subscriptionNotification?: { version: string; notificationType: number; purchaseToken: string; subscriptionId: string };
  testNotification?: { version: string };
}

/**
 * Same "notification is only a pointer, never authoritative on its own"
 * discipline as Apple above — RTDN's payload never carries the full
 * subscription state (see config.ts's GOOGLE_RTDN_* doc comment and the
 * Phase report's "Google verification architecture" section), so this
 * always re-queries subscriptionsv2.get for the purchaseToken before
 * touching Subscription.
 *
 * Retry-safety contract (see the Phase 1.1 report's "Google RTDN retry
 * semantics" section) — identical reasoning to handleAppleNotification
 * above: only a malformed Pub/Sub envelope (bad base64/JSON — this is the
 * Google equivalent of "signature verification failed," since bearer-token
 * authentication itself already happened one layer up in
 * googleRtdnAuth.ts, before this function is ever called) is caught here
 * as `"invalid"`. Every subsequent step is allowed to throw so a transient
 * DB or Play Developer API failure surfaces as a non-2xx and Pub/Sub
 * retries, instead of being silently acknowledged away.
 */
export async function handleGoogleNotification(envelope: GoogleRtdnEnvelope, client: GooglePlayClient): Promise<WebhookOutcome> {
  let decoded: GoogleRtdnDecodedData;
  try {
    decoded = JSON.parse(Buffer.from(envelope.message.data, "base64").toString("utf8")) as GoogleRtdnDecodedData;
  } catch {
    return "invalid";
  }

  // All external/network resolution before any database write — same
  // crash-window reasoning as handleAppleNotification above.
  let state: NormalizedSubscriptionState | undefined;
  const purchaseToken = decoded.subscriptionNotification?.purchaseToken;
  if (purchaseToken) {
    const purchase = await client.getSubscriptionPurchaseV2(purchaseToken);
    const resolved = normalizeGoogleState(purchase, purchaseToken);
    if (resolved.environment === config.APPLE_STORE_ENVIRONMENT) state = resolved;
  }

  return prisma.$transaction(async (tx) => {
    const recorded = await recordBillingEvent(
      {
        businessId: null,
        provider: "GOOGLE",
        providerEventId: envelope.message.messageId,
        eventType: decoded.testNotification ? "TEST" : String(decoded.subscriptionNotification?.notificationType ?? "UNKNOWN"),
        purchaseToken: decoded.subscriptionNotification?.purchaseToken,
      },
      tx,
    );
    if (!recorded) return "duplicate";
    if (!state) return "not-found"; // a test notification, or a shape this backend doesn't act on
    return reconcileByProviderIdentity(state, tx);
  });
}
