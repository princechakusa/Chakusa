export function normalizeApiUrl(value?: string) {
  const candidate = value?.trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, '');
  } catch { return null; }
}

export function publicFeatureEnabled(value?: string) { return value?.trim().toLowerCase() !== 'false'; }
export function googleIosUrlScheme(clientId?: string) { const value = clientId?.trim(); return value && /^[0-9]+-[a-z0-9-]+\.apps\.googleusercontent\.com$/.test(value) ? `com.googleusercontent.apps.${value.slice(0, -'.apps.googleusercontent.com'.length)}` : null; }
export function productionServiceAvailability(enabled: boolean) { return enabled ? 'available' : 'unavailable'; }
export function renderWakeErrorCopy(code?: string) { return code === 'REQUEST_TIMEOUT' ? 'Chakusa is waking up or taking longer than usual. Please try again in a moment.' : 'Unable to reach Chakusa. Check your connection and try again.'; }
export function passwordResetCopy(emailEnabled: boolean) { return emailEnabled ? 'Enter your account email. We will send a secure, single-use reset link.' : 'Password reset email is temporarily unavailable. Contact support if you need help accessing your account.'; }

/**
 * Which native sign-in providers can actually complete on this platform.
 * Google needs the native Google Sign-In SDK (iOS/Android dev or release
 * build) plus its web client ID; Apple needs iOS. Showing a button that can
 * only ever throw is worse than hiding it.
 */
export function socialSignInProviders(input: { platform: string; googleEnabled: boolean; googleWebClientId: string; appleEnabled: boolean }) {
  const native = input.platform === 'ios' || input.platform === 'android';
  const google = native && input.googleEnabled && Boolean(input.googleWebClientId.trim());
  const apple = input.platform === 'ios' && input.appleEnabled;
  return { google, apple, any: google || apple };
}
