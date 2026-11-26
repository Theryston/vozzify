import { z } from 'zod';
import { optional } from './env-values.js';

// Leave both settings unset to use source metadata and manual links without
// automatic identification. Commercial AcoustID provides the URL and key.
export const acoustidEnvSchema = z
  .object({
    ACOUSTID_LOOKUP_URL: optional(z.url({ protocol: /^https$/ })),
    ACOUSTID_COMMERCIAL_API_KEY: optional(z.string().min(1)),
  })
  .refine(
    (env) =>
      Boolean(env.ACOUSTID_LOOKUP_URL) ===
      Boolean(env.ACOUSTID_COMMERCIAL_API_KEY),
    {
      path: ['ACOUSTID_LOOKUP_URL'],
      message: 'Set both AcoustID lookup settings or leave both empty',
    },
  );
