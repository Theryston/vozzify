import { z } from 'zod';

import {
  NAME_MAX_LENGTH,
  OTP_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from './auth-rules.js';

export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN_LENGTH)
  .max(USERNAME_MAX_LENGTH)
  .regex(USERNAME_PATTERN);

/** A User's Name as written by them: trimmed, 1 to {@link NAME_MAX_LENGTH}. */
export const nameSchema = z.string().trim().min(1).max(NAME_MAX_LENGTH);

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH);

const otpSchema = z.string().regex(new RegExp(`^\\d{${OTP_LENGTH}}$`));

/**
 * `POST /v1/auth/sign-up/email` (Better Auth). The username is picked in a
 * separate step, once the email is verified.
 */
export const signUpBodySchema = z.object({
  name: nameSchema,
  email: z.email(),
  password: passwordSchema,
});

export type SignUpBody = z.infer<typeof signUpBodySchema>;

/**
 * The sign-in form. Like legacy, one field takes the email or the username:
 * the client calls `POST /v1/auth/sign-in/email` or `/sign-in/username`
 * (Better Auth) depending on which it is. The password is only required,
 * not checked against the current rules, so no legacy password stops working.
 */
export const signInBodySchema = z.object({
  emailOrUsername: z.string().trim().min(1),
  password: z.string().min(1),
});

export type SignInBody = z.infer<typeof signInBodySchema>;

/** `POST /v1/auth/email-otp/verify-email` (Better Auth). */
export const verifyEmailBodySchema = z.object({
  email: z.email(),
  otp: otpSchema,
});

export type VerifyEmailBody = z.infer<typeof verifyEmailBodySchema>;

/**
 * `PUT /v1/me/username`: the setup step for a user who has no username yet
 * (Google sign-ups). It only succeeds while the username is null, since a
 * username never changes once set. The API lowercases it before storing.
 */
export const setUsernameBodySchema = z.object({ username: usernameSchema });

export type SetUsernameBody = z.infer<typeof setUsernameBodySchema>;

/**
 * `POST /v1/auth/email-otp/request-password-reset` (Better Auth): emails a
 * reset code. Answers the same whether the email has an account or not.
 */
export const forgotPasswordBodySchema = z.object({ email: z.email() });

export type ForgotPasswordBody = z.infer<typeof forgotPasswordBodySchema>;

/** `POST /v1/auth/email-otp/reset-password` (Better Auth). */
export const resetPasswordBodySchema = z.object({
  email: z.email(),
  otp: otpSchema,
  password: passwordSchema,
});

export type ResetPasswordBody = z.infer<typeof resetPasswordBodySchema>;

/** Session fields used for native navigation and onboarding. */
export const authSessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  username: z.string().nullish(),
});

export type AuthSessionUser = z.infer<typeof authSessionUserSchema>;

/** Better Auth's OTP purposes exposed by Vozzify. */
export const sendAuthCodeBodySchema = z.object({
  email: z.email(),
  type: z.enum(['email-verification', 'forget-password']),
});

export type SendAuthCodeBody = z.infer<typeof sendAuthCodeBodySchema>;
export type AuthCodePurpose = SendAuthCodeBody['type'];

/** The two Better Auth credential requests accepted by the same sign-in form. */
const credentialPassword = signInBodySchema.pick({ password: true });
export const signInEmailBodySchema = credentialPassword.extend({
  email: signInBodySchema.shape.emailOrUsername,
});

export type SignInEmailBody = z.infer<typeof signInEmailBodySchema>;

export const signInUsernameBodySchema = credentialPassword.extend({
  username: signInBodySchema.shape.emailOrUsername,
});

export type SignInUsernameBody = z.infer<typeof signInUsernameBodySchema>;

/** `POST /v1/auth/sign-in/social` (Better Auth), native Google ID-token exchange. */
export const signInGoogleBodySchema = z.object({
  provider: z.literal('google'),
  idToken: z.object({ token: z.string().min(1) }),
});

export type SignInGoogleBody = z.infer<typeof signInGoogleBodySchema>;

/** Native clients read the session User and the signed token header. */
export const authSessionResponseSchema = z.object({
  user: authSessionUserSchema,
});

export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export const authCodeResponseSchema = z.object({ success: z.literal(true) });

export type AuthCodeResponse = z.infer<typeof authCodeResponseSchema>;

export const usernameAvailabilityResponseSchema = z.object({
  available: z.boolean(),
});

export type UsernameAvailabilityResponse = z.infer<
  typeof usernameAvailabilityResponseSchema
>;

/** The Better Auth error format under /v1/auth. */
export const authErrorResponseSchema = z.object({ code: z.string() });

export type AuthErrorResponse = z.infer<typeof authErrorResponseSchema>;
