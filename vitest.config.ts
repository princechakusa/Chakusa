import { defineConfig } from "vitest/config";
import { config as loadDotenv } from "dotenv";

// Production Safety Phase 2.1: explicit, deterministic test-env loading —
// do NOT rely on src/lib/config.ts's own `import "dotenv/config"` (which
// loads the root .env, now the PRODUCTION Supabase connection) to pick the
// right file by accident. dotenv only sets a variable if it isn't already
// present in process.env, so loading .env.test here — with override:true,
// and before anything else in this process touches DATABASE_URL — GUARANTEES
// the test database wins: by the time config.ts's `dotenv/config` runs
// later (as part of importing the app), DATABASE_URL/DIRECT_URL are already
// set from .env.test, and dotenv's default non-overriding behavior leaves
// them untouched. See tests/dbSafetyGuard.ts for the second, independent
// layer of protection this does not replace.
loadDotenv({ path: ".env.test", override: true });

process.env.NODE_ENV = "test";
// Required by config.ts unconditionally (no default, min 16 chars) — kept
// out of .env.test deliberately, since that file's scope is the test
// DATABASE_URL/DIRECT_URL only (see the safety guard's own doc comment).
// This fallback means the test suite never depends on the root .env
// having a JWT_SECRET at all, which matters now that the root .env is the
// production Supabase config, not a full local dev file.
process.env.JWT_SECRET ??= "test-only-jwt-secret-not-used-in-production-0000";
process.env.PROVIDER_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
// Fixed, non-functional test credentials so GOOGLE_AUTH_ENABLED /
// APPLE_AUTH_ENABLED can be toggled per-test to prove the flag itself (not
// just credential absence) gates provider auth. These are read once at
// config module load; the *_AUTH_ENABLED flags remain mutable per-test.
process.env.GOOGLE_OAUTH_CLIENT_IDS ??= "test-client.apps.googleusercontent.com";
process.env.APPLE_CLIENT_ID ??= "com.example.chakusa.test";
process.env.APPLE_TEAM_ID ??= "TESTTEAMID";
process.env.APPLE_KEY_ID ??= "TESTKEYID1";
process.env.APPLE_PRIVATE_KEY_BASE64 ??= Buffer.from("not-a-real-key").toString("base64");
// Billing config — tests always inject a fake AppleStoreClient/GooglePlayClient
// (see subscription-billing.test.ts), so these values are never used to make
// a real network call or parse a real key; they only need to satisfy
// config.ts's presence checks and give normalizeAppleState/normalizeGoogleState
// something real to compare transactions/purchases against.
process.env.APPLE_BILLING_ENABLED ??= "true";
process.env.APPLE_BUNDLE_ID ??= "com.chakusa.app";
process.env.APPLE_BILLING_ISSUER_ID ??= "test-issuer-id";
process.env.APPLE_BILLING_KEY_ID ??= "TESTBILLINGKEY1";
process.env.APPLE_BILLING_PRIVATE_KEY_BASE64 ??= Buffer.from("not-a-real-key").toString("base64");
process.env.APPLE_PRO_MONTHLY_PRODUCT_ID ??= "chakusa_pro_monthly";
// A throwaway self-signed test root (generated once via openssl, no real
// trust value) — only needed so buildApp()'s startup validation
// (assertValidAppleRootCertificates) has something parseable to check when
// APPLE_BILLING_ENABLED=true; it is never actually the trust anchor for any
// jws.ts verification test, which either injects a fake AppleStoreClient
// (bypassing real certificate verification entirely) or explicitly tests
// against an empty root set.
process.env.APPLE_ROOT_CERTIFICATES_BASE64 ??=
  "MIIBuzCCAWGgAwIBAgIUGnrWtDortpbqtap1V0Cyd3JfrM8wCgYIKoZIzj0EAwIwMzEaMBgGA1UEAwwRQ2hha3VzYSBUZXN0IFJvb3QxFTATBgNVBAoMDENoYWt1c2EgVGVzdDAeFw0yNjA4MTUxMjA0MTBaFw0zNjA4MTIxMjA0MTBaMDMxGjAYBgNVBAMMEUNoYWt1c2EgVGVzdCBSb290MRUwEwYDVQQKDAxDaGFrdXNhIFRlc3QwWTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAARivSMR5ainG7DdO+jIcm73xX6fMbgcsCktCLssv8rZSbsumWxraHxvkC0qYVpfR/XrOaHWpfpwGMJyo1tCevMdo1MwUTAdBgNVHQ4EFgQUP5xcTeOcdLnn85cMWCd3lki2Uo0wHwYDVR0jBBgwFoAUP5xcTeOcdLnn85cMWCd3lki2Uo0wDwYDVR0TAQH/BAUwAwEB/zAKBggqhkjOPQQDAgNIADBFAiAdfoVecN42ov/HxApHJqPiuYOuYppHRXGa5KJXUvJ7HQIhAIH8z2Esz4mRJ13LsgqEuPWwMsS7QnJdpoma5LPGy777";
process.env.GOOGLE_BILLING_ENABLED ??= "true";
process.env.GOOGLE_PLAY_PACKAGE_NAME ??= "com.chakusa.app";
process.env.GOOGLE_BILLING_SERVICE_ACCOUNT_EMAIL ??= "billing-test@chakusa.iam.gserviceaccount.com";
process.env.GOOGLE_BILLING_SERVICE_ACCOUNT_PRIVATE_KEY_BASE64 ??= Buffer.from("not-a-real-key").toString("base64");
process.env.GOOGLE_PRO_MONTHLY_PRODUCT_ID ??= "chakusa_pro_monthly";
process.env.GOOGLE_RTDN_SERVICE_ACCOUNT_EMAIL ??= "rtdn-test@chakusa.iam.gserviceaccount.com";
process.env.GOOGLE_RTDN_AUDIENCE ??= "https://chakusa.example.com/webhooks/google/subscriptions";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    // Fails the entire run immediately, before any test file executes, if
    // the resolved DATABASE_URL isn't the approved local test database —
    // see tests/testDbSafetySetup.ts and tests/dbSafetyGuard.ts.
    setupFiles: ["./tests/testDbSafetySetup.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
