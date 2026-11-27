import { z } from 'zod';
import { optional } from './env-values.js';

export const googleAuthEnvSchema = z
  .object({
    // Google sign-in is enabled only when both are set.
    GOOGLE_CLIENT_ID: optional(z.string().min(1)),
    GOOGLE_CLIENT_SECRET: optional(z.string().min(1)),
    GOOGLE_NATIVE_CLIENT_IDS: optional(
      z
        .string()
        .transform((value) => value.split(',').map((id) => id.trim()))
        .pipe(
          z
            .array(
              z
                .string()
                .regex(/^[a-zA-Z0-9-]+[.]apps[.]googleusercontent[.]com$/),
            )
            .min(1),
        ),
    ),
  })
  .refine(
    (env) =>
      (env.GOOGLE_CLIENT_ID === undefined) ===
      (env.GOOGLE_CLIENT_SECRET === undefined),
    {
      path: ['GOOGLE_CLIENT_SECRET'],
      message: 'Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither',
    },
  )
  .refine(
    (env) =>
      env.GOOGLE_NATIVE_CLIENT_IDS === undefined ||
      env.GOOGLE_CLIENT_ID !== undefined,
    {
      path: ['GOOGLE_NATIVE_CLIENT_IDS'],
      message:
        'Configure the Google provider before enabling native Google sign-in',
    },
  );
