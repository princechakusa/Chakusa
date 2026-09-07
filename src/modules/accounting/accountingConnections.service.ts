import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { AccountingProvider } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import { ApiError } from "../../lib/errors.js";
import { decryptProviderCredential, encryptProviderCredential } from "../../lib/providerCredentials.js";
import { getAccountingProvider, listConfiguredAccountingProviders } from "../../lib/accounting/accountingProvider.js";

// PROGRAM 3 / Accounting Integrations A1: connection lifecycle only.
// OAuth tokens are encrypted at rest and never returned by any read.
// Nothing here maps an account, a tax code, or a chart of accounts -
// that is a later, separately-audited stage (§19 / §30).

const STATE_TTL_MS = 15 * 60_000;

function signState(businessId: string, provider: AccountingProvider): string {
  const nonce = randomBytes(12).toString("base64url");
  const expiresAt = Date.now() + STATE_TTL_MS;
  const payload = `${businessId}.${provider}.${nonce}.${expiresAt}`;
  const mac = createHmac("sha256", config.JWT_SECRET).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${mac}`;
}

function verifyState(state: string, businessId: string, provider: AccountingProvider): void {
  const [encoded, mac] = state.split(".");
  if (!encoded || !mac) throw ApiError.badRequest("Invalid authorization state");
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = createHmac("sha256", config.JWT_SECRET).update(payload).digest();
  const supplied = Buffer.from(mac, "base64url");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    throw ApiError.badRequest("Invalid authorization state");
  }
  const [stateBusinessId, stateProvider, , expiresAt] = payload.split(".");
  if (stateBusinessId !== businessId || stateProvider !== provider) {
    throw ApiError.badRequest("Authorization state does not match this connection");
  }
  if (Number(expiresAt) <= Date.now()) throw ApiError.badRequest("Authorization state has expired");
}

function requireProvider(provider: AccountingProvider) {
  const adapter = getAccountingProvider(provider);
  if (!adapter) {
    throw ApiError.serviceUnavailable(
      `The ${provider} integration is not configured on this deployment yet`,
    );
  }
  return adapter;
}

const connectionView = {
  id: true,
  provider: true,
  status: true,
  externalOrgId: true,
  externalOrgName: true,
  scopes: true,
  tokenExpiresAt: true,
  lastSyncAt: true,
  lastError: true,
  connectedAt: true,
  disconnectedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export function listAccountingConnections(businessId: string) {
  return prisma.accountingConnection
    .findMany({ where: { businessId }, orderBy: { provider: "asc" }, select: connectionView })
    .then((rows) => ({
      configuredProviders: listConfiguredAccountingProviders(),
      connections: rows,
    }));
}

export async function beginAccountingConnection(
  businessId: string,
  provider: AccountingProvider,
  redirectUri: string,
) {
  const adapter = requireProvider(provider);
  const state = signState(businessId, provider);

  await prisma.accountingConnection.upsert({
    where: { businessId_provider: { businessId, provider } },
    create: { businessId, provider, status: "pending" },
    update: {
      status: "pending",
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      lastError: null,
    },
  });

  const { authorizationUrl } = await adapter.beginAuthorization({ businessId, redirectUri, state });
  return { authorizationUrl, state };
}

export async function completeAccountingConnection(
  businessId: string,
  provider: AccountingProvider,
  input: { code: string; state: string; redirectUri: string },
) {
  const adapter = requireProvider(provider);
  verifyState(input.state, businessId, provider);

  const existing = await prisma.accountingConnection.findUnique({
    where: { businessId_provider: { businessId, provider } },
    select: { id: true, status: true },
  });
  if (!existing || existing.status === "disconnected") {
    throw ApiError.conflict("Start a new connection before completing authorization");
  }

  let grant;
  try {
    grant = await adapter.completeAuthorization({ code: input.code, redirectUri: input.redirectUri });
  } catch (error) {
    await prisma.accountingConnection.update({
      where: { id: existing.id },
      data: { status: "error", lastError: error instanceof Error ? error.message : "Authorization failed" },
    });
    throw ApiError.badRequest("The accounting provider rejected the authorization");
  }

  const updated = await prisma.accountingConnection.update({
    where: { id: existing.id },
    data: {
      status: "connected",
      accessTokenEnc: encryptProviderCredential(grant.accessToken),
      refreshTokenEnc: encryptProviderCredential(grant.refreshToken),
      tokenExpiresAt: new Date(Date.now() + grant.expiresInSeconds * 1000),
      scopes: grant.scopes ?? null,
      externalOrgId: grant.externalOrgId,
      externalOrgName: grant.externalOrgName ?? null,
      connectedAt: new Date(),
      disconnectedAt: null,
      lastError: null,
    },
    select: connectionView,
  });
  return updated;
}

export async function disconnectAccountingConnection(businessId: string, provider: AccountingProvider) {
  const connection = await prisma.accountingConnection.findUnique({
    where: { businessId_provider: { businessId, provider } },
    select: { id: true, status: true, accessTokenEnc: true, refreshTokenEnc: true },
  });
  if (!connection) throw ApiError.notFound("No connection for that provider");

  const adapter = getAccountingProvider(provider);
  if (adapter && connection.accessTokenEnc && connection.refreshTokenEnc) {
    try {
      await adapter.revoke({
        accessToken: decryptProviderCredential(connection.accessTokenEnc),
        refreshToken: decryptProviderCredential(connection.refreshTokenEnc),
      });
    } catch {
      // Best-effort: a provider-side revocation failure must not block the
      // local disconnect. The tokens are cleared below regardless.
    }
  }

  return prisma.accountingConnection.update({
    where: { id: connection.id },
    data: {
      status: "disconnected",
      accessTokenEnc: null,
      refreshTokenEnc: null,
      tokenExpiresAt: null,
      disconnectedAt: new Date(),
      lastError: null,
    },
    select: connectionView,
  });
}
