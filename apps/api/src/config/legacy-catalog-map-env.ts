import { z } from 'zod';

const legacyCatalogMapEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  LEGACY_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
});

/** Parses the minimal destination and source config needed by catalog maps. */
export const parseLegacyCatalogMapEnv = (
  source: Record<string, string | undefined>,
) => {
  const result = legacyCatalogMapEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      'Invalid catalog map environment: DATABASE_URL, LEGACY_DATABASE_URL, REDIS_URL',
    );
  }
  return result.data;
};
