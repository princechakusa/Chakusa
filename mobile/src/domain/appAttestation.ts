// Which requests carry a Play Integrity attestation. Must match the server's
// gate in src/modules/appIntegrity/appIntegrity.routes.ts.
const GATED_AUTH_PATH = /\/(customer\/)?auth\/(login|register|refresh|google|apple)(\?|$)/;

export function isGatedAuthUrl(url: string): boolean {
  return GATED_AUTH_PATH.test(url);
}

export const ATTESTATION_HEADER = 'x-chakusa-attestation';
export const CLIENT_HEADER = 'x-chakusa-client';

/** Attestations last 12 h on the server; renew an hour early. */
export const ATTESTATION_REUSE_MS = 11 * 60 * 60 * 1000;
/** When the server has Play Integrity off, don't ask again for an hour. */
export const DISABLED_RETRY_MS = 60 * 60 * 1000;
