import {
  type AuthCodePurpose,
  type AuthCodeResponse,
  type AuthSessionResponse,
  authCodeResponseSchema,
  authSessionResponseSchema,
  currentUserSchema,
  forgotPasswordBodySchema,
  type ResetPasswordBody,
  resetPasswordBodySchema,
  type SetUsernameBody,
  type SignInBody,
  type SignInEmailBody,
  type SignInUsernameBody,
  type SignUpBody,
  sendAuthCodeBodySchema,
  setUsernameBodySchema,
  signInEmailBodySchema,
  signInUsernameBodySchema,
  signUpBodySchema,
  type UsernameAvailabilityResponse,
  usernameAvailabilityResponseSchema,
  type VerifyEmailBody,
  verifyEmailBodySchema,
} from '@vozzify/contracts';
import type { z } from 'zod';
import { type MobileApiOptions, mobileApi } from '../api/mobile-api';
import { MobileApiError, MobileHttpError } from '../api/mobile-api-error';

const bearerHeader = 'set-auth-token';

function authHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

async function requestAuthSession<T extends z.ZodType>(
  path: `/auth/${string}`,
  options: MobileApiOptions<T>,
) {
  let token: string | null = null;
  const headers = new Headers(options.headers);
  headers.set('x-vozzify-auth', 'native');
  const data = await mobileApi(path, {
    ...options,
    headers,
    onResponseHeaders: (headers) => {
      token = headers.get(bearerHeader);
    },
  });
  return { data, token };
}

async function establishAuthSession<TBody extends z.ZodType>(
  path: `/auth/${string}`,
  options: {
    bodySchema: TBody;
    body: z.input<TBody>;
    locale: string;
    signal: AbortSignal;
  },
): Promise<AuthSessionResponse & { token: string }> {
  const { data, token } = await requestAuthSession(path, {
    method: 'POST',
    schema: authSessionResponseSchema,
    signal: options.signal,
    bodySchema: options.bodySchema,
    body: options.body,
    headers: { 'accept-language': options.locale },
  });
  if (!token) {
    throw new MobileApiError('invalid-response', 'Signed session is missing');
  }
  return { user: data.user, token };
}

export function signIn(body: SignInBody, locale: string, signal: AbortSignal) {
  const { emailOrUsername, password } = body;
  if (emailOrUsername.includes('@')) {
    return establishAuthSession('/auth/sign-in/email', {
      bodySchema: signInEmailBodySchema,
      body: { email: emailOrUsername, password } satisfies SignInEmailBody,
      locale,
      signal,
    });
  }
  return establishAuthSession('/auth/sign-in/username', {
    bodySchema: signInUsernameBodySchema,
    body: { username: emailOrUsername, password } satisfies SignInUsernameBody,
    locale,
    signal,
  });
}

export function signUp(body: SignUpBody, locale: string, signal: AbortSignal) {
  return mobileApi('/auth/sign-up/email', {
    method: 'POST',
    schema: authSessionResponseSchema,
    bodySchema: signUpBodySchema,
    signal,
    body,
    headers: { 'accept-language': locale },
  });
}

export function sendAuthCode(
  email: string,
  type: AuthCodePurpose,
  locale: string,
  signal: AbortSignal,
): Promise<AuthCodeResponse> {
  if (type === 'forget-password') {
    return mobileApi('/auth/email-otp/request-password-reset', {
      method: 'POST',
      schema: authCodeResponseSchema,
      signal,
      bodySchema: forgotPasswordBodySchema,
      body: { email },
      headers: { 'accept-language': locale },
    });
  }
  return mobileApi('/auth/email-otp/send-verification-otp', {
    method: 'POST',
    schema: authCodeResponseSchema,
    signal,
    bodySchema: sendAuthCodeBodySchema,
    body: { email, type },
    headers: { 'accept-language': locale },
  });
}

export function resetPassword(
  body: ResetPasswordBody,
  locale: string,
  signal: AbortSignal,
) {
  return mobileApi('/auth/email-otp/reset-password', {
    method: 'POST',
    schema: authCodeResponseSchema,
    bodySchema: resetPasswordBodySchema,
    signal,
    body,
    headers: { 'accept-language': locale },
  });
}

export function verifyEmail(
  body: VerifyEmailBody,
  locale: string,
  signal: AbortSignal,
) {
  return establishAuthSession('/auth/email-otp/verify-email', {
    bodySchema: verifyEmailBodySchema,
    signal,
    body,
    locale,
  });
}

export function restoreAuthSession(token: string) {
  return requestAuthSession('/auth/get-session', {
    schema: authSessionResponseSchema.nullable(),
    headers: authHeaders(token),
  });
}

export function checkUsername(
  username: string,
  signal: AbortSignal,
): Promise<UsernameAvailabilityResponse> {
  return mobileApi('/auth/is-username-available', {
    method: 'POST',
    schema: usernameAvailabilityResponseSchema,
    bodySchema: setUsernameBodySchema,
    body: { username },
    signal,
  });
}

export async function saveUsername(
  body: SetUsernameBody,
  token: string,
  signal: AbortSignal,
) {
  const headers = authHeaders(token);
  const schema = currentUserSchema;
  try {
    return await mobileApi('/me/username', {
      method: 'PUT',
      schema,
      bodySchema: setUsernameBodySchema,
      body,
      headers,
      signal,
    });
  } catch (error) {
    if (!(error instanceof MobileHttpError) || error.code !== 'CONFLICT') {
      throw error;
    }
    const user = await mobileApi('/me', { schema, headers, signal }).catch(
      (failure: unknown) => {
        if (failure instanceof MobileHttpError && failure.statusCode === 401)
          throw failure;
        throw error;
      },
    );
    if (!user.username) throw error;
    return user;
  }
}
