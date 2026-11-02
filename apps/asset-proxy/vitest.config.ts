import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      thresholds: {
        lines: 89,
        branches: 71,
        functions: 100,
        statements: 84,
      },
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: { r2Buckets: ['PUBLIC_ASSETS'] },
    }),
  ],
});
