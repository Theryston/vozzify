import { z } from 'zod';

import { parseEnv } from './parse-env';

const googleTagManagerEnvSchema = z.object({
  NEXT_PUBLIC_GTM_ENABLED: z.enum(['true', 'false']).default('false'),
});

export function isGoogleTagManagerEnabled(): boolean {
  const env = parseEnv('public', googleTagManagerEnvSchema, {
    NEXT_PUBLIC_GTM_ENABLED: process.env.NEXT_PUBLIC_GTM_ENABLED,
  });
  return (
    process.env.NODE_ENV === 'production' &&
    env.NEXT_PUBLIC_GTM_ENABLED === 'true'
  );
}
