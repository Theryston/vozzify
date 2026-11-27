import {
  MobileAuthError,
  MobileHttpError,
} from '../../lib/api/mobile-api-error';

const knownCodes = [
  'GOOGLE_SIGN_IN_FAILED',
  'INVALID_EMAIL',
  'INVALID_NAME',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'INVALID_EMAIL_OR_PASSWORD',
  'INVALID_USERNAME_OR_PASSWORD',
  'EMAIL_NOT_VERIFIED',
  'INVALID_OTP',
  'OTP_EXPIRED',
  'TOO_MANY_ATTEMPTS',
  'USERNAME_IS_ALREADY_TAKEN',
  'INVALID_USERNAME',
  'USERNAME_TOO_SHORT',
  'USERNAME_TOO_LONG',
] as const;

export function authErrorKey(error: unknown) {
  if (!(error instanceof MobileAuthError || error instanceof MobileHttpError)) {
    return 'UNKNOWN';
  }
  return (
    knownCodes.find((code) => code === error.code) ??
    (
      {
        401: 'UNAUTHORIZED',
        409: 'USERNAME_IS_ALREADY_TAKEN',
        429: 'RATE_LIMITED',
      } as const
    )[error.statusCode as 401 | 409 | 429] ??
    'UNKNOWN'
  );
}

export function isCodeError(key: string | undefined) {
  return (
    key === 'INVALID_OTP' ||
    key === 'OTP_EXPIRED' ||
    key === 'TOO_MANY_ATTEMPTS'
  );
}
