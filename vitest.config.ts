import { defineConfig } from "vitest/config";

process.env.NODE_ENV = "test";
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

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});
