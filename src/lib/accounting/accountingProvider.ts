import type { AccountingProvider as AccountingProviderKey } from "@prisma/client";

// PROGRAM 3 / Accounting Integrations (roadmap stage 9, master directive §19).
//
// Provider-neutral OAuth contract. A concrete QuickBooks / Xero adapter
// implements this; nothing here talks to a real API. The registry below
// is EMPTY until real credentials are configured, so every route that
// needs a provider returns 503 "not configured" in production - this is
// the honest FOUNDATION COMPLETE / PRODUCTION CONFIGURATION REQUIRED
// boundary, never a fabricated success.

export interface AccountingAuthorizationStart {
  /** Where to send the business owner to grant access. */
  authorizationUrl: string;
}

export interface AccountingTokenGrant {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresInSeconds: number;
  scopes?: string;
  /** The provider's org identifier (QuickBooks realmId / Xero tenantId). */
  externalOrgId: string;
  externalOrgName?: string;
}

export interface AccountingProviderAdapter {
  readonly key: AccountingProviderKey;
  /** Build the provider's consent URL for this `state`. No network call. */
  beginAuthorization(input: { businessId: string; redirectUri: string; state: string }): Promise<AccountingAuthorizationStart>;
  /** Exchange an authorization code for tokens. */
  completeAuthorization(input: { code: string; redirectUri: string }): Promise<AccountingTokenGrant>;
  /** Exchange a refresh token for a fresh grant. */
  refresh(input: { refreshToken: string }): Promise<AccountingTokenGrant>;
  /** Best-effort token revocation on disconnect. Must not throw on a 4xx. */
  revoke(input: { accessToken: string; refreshToken: string }): Promise<void>;
}

const registry = new Map<AccountingProviderKey, AccountingProviderAdapter>();

/** Test/bootstrap injection point for a concrete adapter. */
export function registerAccountingProvider(adapter: AccountingProviderAdapter): void {
  registry.set(adapter.key, adapter);
}

export function clearAccountingProviders(): void {
  registry.clear();
}

export function getAccountingProvider(key: AccountingProviderKey): AccountingProviderAdapter | null {
  return registry.get(key) ?? null;
}

export function listConfiguredAccountingProviders(): AccountingProviderKey[] {
  return [...registry.keys()];
}
