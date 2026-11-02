import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { coverage: { provider: 'istanbul' } },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: { r2Buckets: ['PUBLIC_ASSETS'] },
    }),
  ],
});
