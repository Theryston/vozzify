import { Platform } from 'react-native';
import { getMobileEnv, type MobileEnv } from '../api/mobile-env';

export function isGoogleSignInAvailable() {
  const { google } = getMobileEnv();
  return (
    google !== undefined &&
    (Platform.OS === 'android' ||
      (Platform.OS === 'ios' && google.iosClientId !== undefined))
  );
}

export async function chooseGoogleAccount(): Promise<string | null> {
  const { google } = getMobileEnv();
  if (!google) throw new Error('Google sign-in is not configured');
  return openAccountPicker(google);
}

async function openAccountPicker(google: NonNullable<MobileEnv['google']>) {
  // Resolve the native module only when an OAuth-enabled build uses it.
  const sdk: typeof import('@react-native-google-signin/google-signin') =
    require('@react-native-google-signin/google-signin');
  const { GoogleSignin, isCancelledResponse } = sdk;
  GoogleSignin.configure(google);
  if (Platform.OS === 'android') {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  }
  const result = await GoogleSignin.signIn();
  if (isCancelledResponse(result)) return null;
  if (!result.data.idToken)
    throw new Error('Google did not return an ID token');
  return result.data.idToken;
}
