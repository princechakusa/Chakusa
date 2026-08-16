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
export function productionServiceAvailability(enabled: boolean) { return enabled ? 'available' : 'unavailable'; }
export function renderWakeErrorCopy(code?: string) { return code === 'REQUEST_TIMEOUT' ? 'Chakusa is waking up or taking longer than usual. Please try again in a moment.' : 'Unable to reach Chakusa. Check your connection and try again.'; }
export function passwordResetCopy(emailEnabled: boolean) { return emailEnabled ? 'Enter your account email. We will send a secure, single-use reset link.' : 'Password reset email is temporarily unavailable. Contact support if you need help accessing your account.'; }
