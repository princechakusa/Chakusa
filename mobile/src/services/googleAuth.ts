import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { Platform } from 'react-native';
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '../config';

let configured = false;

export class GoogleAuthenticationError extends Error {}

function configureGoogle() {
  if (Platform.OS === 'web') {
    throw new GoogleAuthenticationError('Google Sign-In requires an iOS or Android development build.');
  }
  if (!GOOGLE_WEB_CLIENT_ID) {
    throw new GoogleAuthenticationError('Google Sign-In is not configured. Set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and rebuild the app.');
  }
  if (Platform.OS === 'ios' && !GOOGLE_IOS_CLIENT_ID) {
    throw new GoogleAuthenticationError('Google Sign-In is not configured for iOS. Set EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID and rebuild the app.');
  }
  if (!configured) {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      iosClientId: Platform.OS === 'ios' ? GOOGLE_IOS_CLIENT_ID : undefined,
      offlineAccess: false,
    });
    configured = true;
  }
}

export async function requestGoogleIdToken(options: { fresh?: boolean } = {}): Promise<string | null> {
  configureGoogle();
  try {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    if (options.fresh) await GoogleSignin.signOut();
    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') return null;
    if (!response.data.idToken) {
      throw new GoogleAuthenticationError('Google did not return an identity token. Check the configured web client ID.');
    }
    return response.data.idToken;
  } catch (error) {
    if (error instanceof GoogleAuthenticationError) throw error;
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.IN_PROGRESS) {
        throw new GoogleAuthenticationError('Google Sign-In is already in progress.');
      }
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new GoogleAuthenticationError('Google Play Services is unavailable or needs an update.');
      }
    }
    throw new GoogleAuthenticationError('Google Sign-In could not be completed. Please try again.');
  }
}
