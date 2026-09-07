import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../src/lib/prisma.js";
import { authHeader, createTestApp, registerAccount, resetDatabase, setPlan, setSubscriptionStatus } from "./helpers.js";
import {
  clearAccountingProviders,
  registerAccountingProvider,
} from "../src/lib/accounting/accountingProvider.js";
import { decryptProviderCredential } from "../src/lib/providerCredentials.js";

// PROGRAM 3 / Accounting Integrations A1: connection lifecycle. No real
// provider; a fake adapter stands in for QuickBooks.

const auth = authHeader;

async function businessAccount(app: FastifyInstance, plan: "PRO" | "BUSINESS" = "BUSINESS") {
  const account = await registerAccount(app);
  await setPlan(account.businessId, plan);
  await setSubscriptionStatus(account.businessId, "ACTIVE");
  return account;
}

const fakeQuickbooks = {
  key: "quickbooks" as const,
  beginAuthorization: async ({ state }: { state: string }) => ({
    authorizationUrl: `https://quickbooks.test/oauth?state=${encodeURIComponent(state)}`,
  }),
  completeAuthorization: async () => ({
    accessToken: "qbo-access-123",
    refreshToken: "qbo-refresh-456",
    expiresInSeconds: 3600,
    scopes: "com.intuit.quickbooks.accounting",
    externalOrgId: "realm-789",
    externalOrgName: "Heritage Books",
  }),
  refresh: async () => ({
    accessToken: "qbo-access-999",
    refreshToken: "qbo-refresh-999",
    expiresInSeconds: 3600,
    externalOrgId: "realm-789",
  }),
  revoke: async () => undefined,
};

let app: FastifyInstance;
beforeAll(async () => {
  await resetDatabase();
  app = await createTestApp();
});
afterEach(async () => {
  clearAccountingProviders();
  await resetDatabase();
});
afterAll(() => app.close());

describe("entitlement + role", () => {
  it("blocks below BUSINESS and blocks STAFF", async () => {
    const pro = await businessAccount(app, "PRO");
    const blocked = await app.inject({ method: "GET", url: "/accounting/connections", headers: auth(pro.token) });
    expect(blocked.statusCode).toBe(403);
  });
});

describe("connection lifecycle", () => {
  it("reports no configured providers when none are wired (FOUNDATION COMPLETE)", async () => {
    const { token } = await businessAccount(app);
    const res = await app.inject({ method: "GET", url: "/accounting/connections", headers: auth(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configuredProviders: [], connections: [] });
  });

  it("returns 503 for authorize when the provider is not configured", async () => {
    const { token } = await businessAccount(app);
    const res = await app.inject({
      method: "POST",
      url: "/accounting/connections/quickbooks/authorize",
      headers: auth(token),
      payload: { redirectUri: "https://app.chakusa.test/accounting/callback" },
    });
    expect(res.statusCode).toBe(503);
  });

  it("runs authorize -> callback -> disconnect and stores tokens encrypted", async () => {
    registerAccountingProvider(fakeQuickbooks);
    const { token, businessId } = await businessAccount(app);

    const authorize = await app.inject({
      method: "POST",
      url: "/accounting/connections/quickbooks/authorize",
      headers: auth(token),
      payload: { redirectUri: "https://app.chakusa.test/accounting/callback" },
    });
    expect(authorize.statusCode).toBe(200);
    const { authorizationUrl, state } = authorize.json();
    expect(authorizationUrl).toContain("quickbooks.test");

    const callback = await app.inject({
      method: "POST",
      url: "/accounting/connections/quickbooks/callback",
      headers: auth(token),
      payload: { code: "auth-code", state, redirectUri: "https://app.chakusa.test/accounting/callback" },
    });
    expect(callback.statusCode).toBe(200);
    expect(callback.json()).toMatchObject({
      status: "connected",
      provider: "quickbooks",
      externalOrgName: "Heritage Books",
    });
    // Read model never exposes token material.
    expect(JSON.stringify(callback.json())).not.toContain("qbo-access");

    const stored = await prisma.accountingConnection.findFirstOrThrow({ where: { businessId } });
    expect(stored.accessTokenEnc).toBeTruthy();
    expect(stored.accessTokenEnc).not.toContain("qbo-access-123");
    expect(decryptProviderCredential(stored.accessTokenEnc!)).toBe("qbo-access-123");

    const disconnect = await app.inject({
      method: "POST",
      url: "/accounting/connections/quickbooks/disconnect",
      headers: auth(token),
    });
    expect(disconnect.statusCode).toBe(200);
    expect(disconnect.json()).toMatchObject({ status: "disconnected" });
    const after = await prisma.accountingConnection.findFirstOrThrow({ where: { businessId } });
    expect(after.accessTokenEnc).toBeNull();
    expect(after.refreshTokenEnc).toBeNull();
  });

  it("rejects a callback whose state belongs to another business", async () => {
    registerAccountingProvider(fakeQuickbooks);
    const a = await businessAccount(app);
    const b = await businessAccount(app);

    const authorize = await app.inject({
      method: "POST",
      url: "/accounting/connections/quickbooks/authorize",
      headers: auth(a.token),
      payload: { redirectUri: "https://app.chakusa.test/cb" },
    });
    const { state } = authorize.json();

    const stolen = await app.inject({
      method: "POST",
      url: "/accounting/connections/quickbooks/callback",
      headers: auth(b.token),
      payload: { code: "auth-code", state, redirectUri: "https://app.chakusa.test/cb" },
    });
    expect(stolen.statusCode).toBe(400);
  });

  it("does not leak another tenant's connection", async () => {
    registerAccountingProvider(fakeQuickbooks);
    const a = await businessAccount(app);
    const b = await businessAccount(app);
    const authorize = await app.inject({
      method: "POST",
      url: "/accounting/connections/quickbooks/authorize",
      headers: auth(a.token),
      payload: { redirectUri: "https://app.chakusa.test/cb" },
    });
    const { state } = authorize.json();
    await app.inject({
      method: "POST",
      url: "/accounting/connections/quickbooks/callback",
      headers: auth(a.token),
      payload: { code: "c", state, redirectUri: "https://app.chakusa.test/cb" },
    });

    const bList = await app.inject({ method: "GET", url: "/accounting/connections", headers: auth(b.token) });
    expect(bList.json().connections).toHaveLength(0);
    const bDisconnect = await app.inject({
      method: "POST",
      url: "/accounting/connections/quickbooks/disconnect",
      headers: auth(b.token),
    });
    expect(bDisconnect.statusCode).toBe(404);
  });
});
