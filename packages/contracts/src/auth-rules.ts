/**
 * Auth rules shared by the API and the clients' forms. Kept free of Zod so
 * clients can import them (`@vozzify/contracts/auth-rules`) without
 * shipping the schema library on first load.
 */

/**
 * Shortest password accepted on sign-up and reset (legacy: 6). Sign-in
 * doesn't check it, so no existing password stops working.
 */
export const PASSWORD_MIN_LENGTH = 6;
/** Better Auth's default maximum. */
export const PASSWORD_MAX_LENGTH = 128;

// Legacy username rules: 3-50 characters, letters, digits and underscores.
// The API lowercases the input before storing it, as legacy did.
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 50;
// Spells out both letter cases instead of using the `i` flag: JSON Schema and
// OpenAPI patterns carry no flags, so the generated OpenAPI document would
// drop it and describe lowercase letters only. The accepted set is the same.
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

/**
 * Longest Name accepted when one is written (sign-up, edit profile). Names
 * imported from the legacy app may be longer: they stay valid as they are and
 * only need shortening when their owner edits them.
 */
export const NAME_MAX_LENGTH = 100;

/** Length of the email verification and password-reset codes. */
export const OTP_LENGTH = 6;

/** Whether `value` passes the username rules (without Zod). */
export const isValidUsername = (value: string): boolean =>
  value.length >= USERNAME_MIN_LENGTH &&
  value.length <= USERNAME_MAX_LENGTH &&
  USERNAME_PATTERN.test(value);

/** Informational only. Password acceptance is governed by the shared schema. */
export type PasswordStrength = 0 | 1 | 2 | 3;

export function passwordStrength(password: string): PasswordStrength {
  if (password.length < PASSWORD_MIN_LENGTH) return 0;
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  const long = password.length >= 12;
  if (long && variety >= 3) return 3;
  return long || variety >= 3 ? 2 : 1;
}
