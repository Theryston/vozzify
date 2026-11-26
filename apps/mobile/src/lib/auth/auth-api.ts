import {
  type AuthCodePurpose,
  authSessionUserSchema,
  currentUserSchema,
  type SetUsernameBody,
  type SignInBody,
  type SignUpBody,
  sendAuthCodeBodySchema,
  setUsernameBodySchema,
  signUpBodySchema,
  type VerifyEmailBody,
  verifyEmailBodySchema,
} from '@vozzify/contracts';
import { z } from 'zod';
import { type MobileApiOptions, mobileApi } from '../api/mobile-api';
import { MobileApiError } from '../api/mobile-api-error';

const sessionSchema = z.object({ user: authSessionUserSchema });
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
  options: { bodySchema: TBody; body: z.input<TBody>; locale: string },
) {
  const { data, token } = await requestAuthSession(path, {
    method: 'POST',
    schema: sessionSchema,
    bodySchema: options.bodySchema,
    body: options.body,
    headers: { 'accept-language': options.locale },
  });
  if (!token) {
    throw new MobileApiError('invalid-response', 'Signed session is missing');
  }
  return { user: data.user, token };
}

export function signIn(body: SignInBody, locale: string) {
  const { emailOrUsername, password } = body;
  const field = emailOrUsername.includes('@') ? 'email' : 'username';
  return establishAuthSession(`/auth/sign-in/${field}`, {
    bodySchema: z.object({ [field]: z.string(), password: z.string() }),
    body: { [field]: emailOrUsername, password },
    locale,
  });
}

export function signUp(body: SignUpBody, locale: string) {
  return mobileApi('/auth/sign-up/email', {
    method: 'POST',
    schema: sessionSchema,
    bodySchema: signUpBodySchema,
    body,
    headers: { 'accept-language': locale },
  });
}

export function sendAuthCode(
  email: string,
  type: AuthCodePurpose,
  locale: string,
) {
  return mobileApi('/auth/email-otp/send-verification-otp', {
    method: 'POST',
    schema: z.object({ success: z.boolean() }),
    bodySchema: sendAuthCodeBodySchema,
    body: { email, type },
    headers: { 'accept-language': locale },
  });
}

export function verifyEmail(body: VerifyEmailBody, locale: string) {
  return establishAuthSession('/auth/email-otp/verify-email', {
    bodySchema: verifyEmailBodySchema,
    body,
    locale,
  });
}

export function restoreAuthSession(token: string) {
  return requestAuthSession('/auth/get-session', {
    schema: sessionSchema.nullable(),
    headers: authHeaders(token),
  });
}

export function checkUsername(username: string, signal: AbortSignal) {
  return mobileApi('/auth/is-username-available', {
    method: 'POST',
    schema: z.object({ available: z.boolean() }),
    bodySchema: setUsernameBodySchema,
    body: { username },
    signal,
  });
}

export function saveUsername(body: SetUsernameBody, token: string) {
  return mobileApi('/me/username', {
    method: 'PUT',
    schema: currentUserSchema,
    bodySchema: setUsernameBodySchema,
    body,
    headers: authHeaders(token),
  });
}
