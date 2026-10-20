import type { z } from "zod";
import { config } from "../../lib/config.js";
import { ApiError } from "../../lib/errors.js";
import type { deleteAccountSchema } from "./auth.schemas.js";
import {
  deleteAccount,
  deleteAccountWithApple,
  deleteAccountWithGoogle,
  getAppleDeletionCredential,
  getOptionalAppleDeletionCredential,
  validateAppleChallenge,
  verifyAccountPassword,
} from "./auth.service.js";
import { requireFreshGoogleIdentity, type GoogleTokenVerifier } from "./googleVerifier.js";
import type { AppleCodeExchanger, AppleCredentialRevoker, AppleTokenVerifier } from "./appleAuth.js";

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

export interface AccountDeletionDeps {
  googleTokenVerifier: GoogleTokenVerifier;
  appleTokenVerifier: AppleTokenVerifier;
  appleCodeExchanger: AppleCodeExchanger;
  appleCredentialRevoker: AppleCredentialRevoker;
}

/**
 * Permanently deletes a user after a fresh identity check (password, Google
 * or Apple), revoking any Apple credential and every session. Shared by the
 * business (/auth) and customer (/customer/auth) apps: one user, one rule set,
 * including the owner-with-active-staff protection in deleteAccount*.
 */
export function createAccountDeleter(deps: AccountDeletionDeps) {
  const exchangeAndBindAppleCode = async (authorizationCode: string, nonce: string, presentedSubject: string, presentedEmail: string) => {
    const tokens = await deps.appleCodeExchanger(authorizationCode);
    const exchanged = await deps.appleTokenVerifier(tokens.identityToken, nonce);
    if (exchanged.providerSubject !== presentedSubject || exchanged.email.toLowerCase() !== presentedEmail.toLowerCase()) {
      throw ApiError.auth(401, "APPLE_CODE_INVALID", "Apple authorization code does not match the presented identity");
    }
    return tokens;
  };

  const revokeLinkedApple = async (userId: string) => {
    // Only when Apple auth is still on: with it off there is no live provider
    // to revoke against, and deletion must still proceed.
    if (!config.APPLE_AUTH_ENABLED) return;
    const apple = await getOptionalAppleDeletionCredential(userId);
    if (apple) await deps.appleCredentialRevoker(apple.refreshToken);
  };

  return async function deleteUserAccount(userId: string, input: DeleteAccountInput): Promise<void> {
    if ("password" in input) {
      await verifyAccountPassword(userId, input.password);
      await revokeLinkedApple(userId);
      await deleteAccount(userId, input.password);
    } else if ("googleIdToken" in input) {
      const verifiedIdentity = await deps.googleTokenVerifier(input.googleIdToken);
      requireFreshGoogleIdentity(verifiedIdentity);
      await revokeLinkedApple(userId);
      await deleteAccountWithGoogle(userId, verifiedIdentity.providerSubject);
    } else {
      const proof = { challengeId: input.apple.challengeId, nonce: input.apple.nonce, state: input.apple.state };
      await validateAppleChallenge(proof, "APPLE_DELETE", userId);
      const identity = await deps.appleTokenVerifier(input.apple.identityToken, input.apple.nonce);
      const stored = await getAppleDeletionCredential(userId);
      if (stored.providerSubject !== identity.providerSubject) {
        throw ApiError.auth(401, "AUTH_REAUTHENTICATION_REQUIRED", "Apple account confirmation failed");
      }
      const fresh = await exchangeAndBindAppleCode(input.apple.authorizationCode, input.apple.nonce, identity.providerSubject, identity.email);
      for (const token of new Set([stored.refreshToken, fresh.refreshToken])) await deps.appleCredentialRevoker(token);
      await deleteAccountWithApple(userId, identity.providerSubject, proof);
    }
  };
}
