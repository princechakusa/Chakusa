import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

export interface AppleChallenge { challengeId: string; nonce: string; state: string; expiresAt: string; }
export interface AppleCredentialPayload extends Pick<AppleChallenge, 'challengeId' | 'nonce' | 'state'> {
  identityToken: string;
  authorizationCode: string;
  givenName?: string | null;
  familyName?: string | null;
}

export class AppleAuthenticationError extends Error {}

export async function requestAppleCredential(challenge: AppleChallenge): Promise<AppleCredentialPayload | null> {
  if (Platform.OS !== 'ios' || !await AppleAuthentication.isAvailableAsync()) {
    throw new AppleAuthenticationError('Sign in with Apple requires a supported iOS device and a native development build.');
  }
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: challenge.nonce,
      state: challenge.state,
    });
    if (!credential.identityToken || !credential.authorizationCode || credential.state !== challenge.state) {
      throw new AppleAuthenticationError('Apple did not return a complete authentication response. Please try again.');
    }
    return {
      challengeId: challenge.challengeId,
      nonce: challenge.nonce,
      state: challenge.state,
      identityToken: credential.identityToken,
      authorizationCode: credential.authorizationCode,
      givenName: credential.fullName?.givenName,
      familyName: credential.fullName?.familyName,
    };
  } catch (error) {
    if (error instanceof AppleAuthenticationError) throw error;
    if (error instanceof Error && 'code' in error && error.code === 'ERR_REQUEST_CANCELED') return null;
    throw new AppleAuthenticationError('Sign in with Apple could not be completed. Please try again.');
  }
}
