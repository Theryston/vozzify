import 'server-only';
import { z } from 'zod';

import { parseEnv } from './parse-env';

/** `host[:port]` only: no scheme, path, query, fragment or credentials. */
function isBareHost(value: string): boolean {
  let url: URL;
  try {
    url = new URL(`https://${value}`);
  } catch {
    return false;
  }
  return (
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    url.username === '' &&
    url.password === ''
  );
}

const serverEnvSchema = z.object({
  API_URL: z.url(),
  REVALIDATE_SECRET: z.string().min(32),
  // Read by `cache-handlers/redis.ts` (outside the app bundle, so it parses
  // it again); listed here so a malformed value fails at server start.
  CACHE_REDIS_URL: z
    .url({ protocol: /^rediss?$/ })
    .optional()
    .or(z.literal('').transform(() => undefined)),
  // Extra domains the sitemaps answer for, besides NEXT_PUBLIC_SITE_URL's
  // host. A request for any other host gets the site URL's origin, so an
  // unknown Host header never ends up in sitemap URLs.
  SITEMAP_EXTRA_HOSTS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((host) => host.trim().toLowerCase())
        .filter((host) => host !== ''),
    )
    .pipe(
      z.array(
        z
          .string()
          .refine(isBareHost, 'must be a bare host such as vozzify.example'),
      ),
    ),
  // e2e builds only: the practice page plays with a fake clock instead of
  // YouTube. Anything but `true` or `false` fails at start, so a typo cannot
  // quietly leave it on.
  E2E_FAKE_PLAYER: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ADSENSE_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  ADSENSE_CLIENT: z
    .string()
    .regex(/^ca-pub-[0-9]+$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  ADSENSE_SLOT: z
    .string()
    .regex(/^[0-9]+$/)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  ADSENSE_LAYOUT_KEY: z
    .string()
    .min(1)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  ADSENSE_CMP_URL: z
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export type ServerEnv = z.output<typeof serverEnvSchema>;

let cached: ServerEnv | undefined;

/**
 * Parsed lazily (and validated eagerly on server start by
 * `instrumentation.ts`) so `next build` doesn't need runtime secrets.
 */
export function getServerEnv(): ServerEnv {
  cached ??= parseEnv('server', serverEnvSchema, {
    API_URL: process.env.API_URL,
    REVALIDATE_SECRET: process.env.REVALIDATE_SECRET,
    CACHE_REDIS_URL: process.env.CACHE_REDIS_URL,
    SITEMAP_EXTRA_HOSTS: process.env.SITEMAP_EXTRA_HOSTS,
    E2E_FAKE_PLAYER: process.env.E2E_FAKE_PLAYER,
    ADSENSE_ENABLED: process.env.ADSENSE_ENABLED,
    ADSENSE_CLIENT: process.env.ADSENSE_CLIENT,
    ADSENSE_SLOT: process.env.ADSENSE_SLOT,
    ADSENSE_LAYOUT_KEY: process.env.ADSENSE_LAYOUT_KEY,
    ADSENSE_CMP_URL: process.env.ADSENSE_CMP_URL,
  });
  return cached;
}
