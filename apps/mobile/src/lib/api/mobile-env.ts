import Constants from 'expo-constants';
import { z } from 'zod';

import { mobileApiUrlSchema } from './api-url';

const mobileEnvSchema = z.object({
  apiBaseUrl: mobileApiUrlSchema,
});

export type MobileEnv = z.infer<typeof mobileEnvSchema>;

export function parseMobileEnv(source: unknown): MobileEnv {
  const parsed = mobileEnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid mobile configuration: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

export function getMobileEnv(): MobileEnv {
  return parseMobileEnv(Constants.expoConfig?.extra);
}
