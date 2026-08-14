export type ExternalDestination = { kind: 'url'; value: string } | { kind: 'email'; value: string } | null;
export const APPROVED_PUBLIC_DESTINATIONS = { privacy: 'https://chakusa.com/privacy', terms: 'https://chakusa.com/terms', support: 'https://chakusa.com/support', deleteAccount: 'https://chakusa.com/delete-account', supportEmail: 'support@chakusa.com' } as const;

function validHttpsUrl(value?: string) {
  if (!value) return null;
  try { const url = new URL(value); return url.protocol === 'https:' ? url.toString() : null; } catch { return null; }
}

export function legalDestination(value?: string): ExternalDestination {
  const url = validHttpsUrl(value?.trim());
  return url ? { kind: 'url', value: url } : null;
}

export function supportDestination(urlValue?: string, emailValue?: string): ExternalDestination {
  const url = validHttpsUrl(urlValue?.trim());
  if (url) return { kind: 'url', value: url };
  const email = emailValue?.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { kind: 'email', value: email } : null;
}

export function formatAppVersion(version?: string, buildNumber?: string | number) {
  const cleanVersion = version?.trim();
  if (!cleanVersion) return 'Version unavailable';
  return buildNumber === undefined || String(buildNumber).trim() === '' ? `Version ${cleanVersion}` : `Version ${cleanVersion} (${buildNumber})`;
}

export function deletionConfirmationCopy(businessName?: string | null) {
  return businessName ? `Delete your account and ${businessName}? This cannot be undone.` : 'Delete your account? This cannot be undone.';
}

export function proDisclosureReady(terms: ExternalDestination, privacy: ExternalDestination) {
  return Boolean(terms && privacy);
}
