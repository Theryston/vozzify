import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin({
  requestConfig: './lib/i18n/request.ts',
});

// Static pages bake absolute canonical/hreflang URLs in at build time.
if (
  process.env.NODE_ENV === 'production' &&
  process.env.NEXT_PUBLIC_SITE_URL === undefined
) {
  console.warn(
    'NEXT_PUBLIC_SITE_URL is not set: canonical and hreflang URLs will point ' +
      'at http://localhost:3000. Set it when building production images.',
  );
}

// Next imports the handler natively at runtime (it is not bundled), so it is
// referenced by absolute file URL. Without CACHE_REDIS_URL it behaves exactly
// like Next's default in-memory handler.
const cacheHandler = new URL('./cache-handlers/redis.ts', import.meta.url).href;

const nextConfig: NextConfig = {
  cacheComponents: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'coverartarchive.org',
        pathname: '/release/**',
      },
      {
        protocol: 'https',
        hostname: 'coverartarchive.org',
        pathname: '/release-group/**',
      },
      {
        protocol: 'https',
        hostname: 'assets.vozzify.com',
        pathname: '/storage/**',
      },
      {
        protocol: 'https',
        hostname: 'assets.vozzify.com',
        pathname: '/cover-art-archive/**',
      },
    ],
  },
  // One handler instance backs both `'use cache'` and `'use cache: remote'`:
  // every entry is shared across instances and survives restarts, and there
  // is a single tag state to keep in sync.
  cacheHandlers: {
    default: cacheHandler,
    remote: cacheHandler,
  },
};

export default withNextIntl(nextConfig);
