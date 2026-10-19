import { Platform } from 'react-native';
import { API_URL, PLAY_INTEGRITY_PROJECT_NUMBER } from '../config';
import { ATTESTATION_HEADER, ATTESTATION_REUSE_MS, CLIENT_HEADER, DISABLED_RETRY_MS, isGatedAuthUrl } from '../domain/appAttestation';

// Proves to the API that sign-in comes from the genuine Play build (server
// side: src/modules/appIntegrity). Failures never block here; the server
// decides, so a Play outage or an "off" server leaves sign-in unchanged.

const ATTEST_TIMEOUT_MS = 8000;
let cached: { value: string; until: number } | null = null;
let disabledUntil = 0;
let pending: Promise<string | null> | null = null;

async function post(path: string, body?: unknown): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', [CLIENT_HEADER]: 'android' },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function obtainAttestation(): Promise<string | null> {
  if (!PLAY_INTEGRITY_PROJECT_NUMBER || !API_URL) return null;
  const challengeResponse = await post('/app-integrity/challenge');
  if (challengeResponse?.status === 404) { disabledUntil = Date.now() + DISABLED_RETRY_MS; return null; }
  if (!challengeResponse?.ok) return null;
  const { challenge, nonce } = await challengeResponse.json() as { challenge: string; nonce: string };
  // Loaded only when an Android device actually attests, so web, iOS and tests never touch the native module.
  const { requestIntegrityToken } = await import('../../modules/chakusa-app-integrity');
  const integrityToken = await requestIntegrityToken(nonce, PLAY_INTEGRITY_PROJECT_NUMBER);
  if (!integrityToken) return null;
  const attestResponse = await post('/app-integrity/attest', { challenge, integrityToken });
  if (!attestResponse?.ok) return null;
  const { attestation } = await attestResponse.json() as { attestation: string };
  cached = { value: attestation, until: Date.now() + ATTESTATION_REUSE_MS };
  return attestation;
}

async function currentAttestation(): Promise<string | null> {
  if (cached && cached.until > Date.now()) return cached.value;
  if (Date.now() < disabledUntil) return null;
  pending ??= obtainAttestation().catch(() => null).finally(() => { pending = null; });
  return pending;
}

/** Extra headers for an API request: Android identifies itself, and sign-in requests carry the attestation. */
export async function appIntegrityHeaders(url: string): Promise<Record<string, string>> {
  if (Platform.OS !== 'android') return {};
  const headers: Record<string, string> = { [CLIENT_HEADER]: 'android' };
  if (isGatedAuthUrl(url)) {
    const attestation = await currentAttestation();
    if (attestation) headers[ATTESTATION_HEADER] = attestation;
  }
  return headers;
}
