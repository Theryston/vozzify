import { fileURLToPath } from 'node:url';

import { defineConfig, devices } from '@playwright/test';

import { webServerEnv } from './e2e/web-server-env';

const port = 3000;
const baseURL = `http://localhost:${port}`;
const isCI = Boolean(process.env.CI);
// The streak specs sing into the fake microphone too, so they run there.
const micSpec = /(track-mic|track-streak|streak-toast-clearance)\.spec\.ts$/;
const sharedHomeSpecs = /home(?:-discovery|-ranked)?\.spec\.ts$/;
// Escape hatch for machines with a preinstalled Chromium that doesn't match
// this Playwright version (and can't download one). CI leaves it unset and
// uses `playwright install`.
const launchOptions = {
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
};
const fakeVoice = fileURLToPath(
  new URL('./e2e/fixtures/a4-440hz.wav', import.meta.url),
);

/**
 * E2E tests run against a production build (`next start`), so they see the
 * same proxy, prerendering and caching behavior as production. The build
 * itself is not done here: Turbo's `web#test:e2e` depends on `web#build`
 * (cached), so `nub run test:e2e` never builds twice. Running Playwright
 * directly requires `nub run build --filter=web` first.
 */
export default defineConfig({
  testDir: './e2e',
  testIgnore: ['real-search/**'],
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      // The mic specs get their own project below: a fake microphone that is
      // granted without a prompt must not reach any other spec.
      testIgnore: [micSpec, sharedHomeSpecs],
      use: { ...devices['Desktop Chrome'], launchOptions },
    },
    {
      name: 'chromium-home',
      testMatch: sharedHomeSpecs,
      // These files mutate the same fake feed and Next cache tags across files.
      workers: 1,
      use: { ...devices['Desktop Chrome'], launchOptions },
    },
    {
      name: 'chromium-mic',
      testMatch: micSpec,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          ...launchOptions,
          // A fake microphone that "sings" a known A4 on a loop. The fake UI
          // grants the permission without a prompt.
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-audio-capture=${fakeVoice}`,
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: `next start --port ${port}`,
      url: baseURL,
      env: webServerEnv,
      // Never attach to a `next dev` server left running on the same port:
      // its behavior differs from production and would hide real failures.
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 60_000,
    },
    // Server Components fetch from the Next server, not the browser, so
    // `page.route` cannot mock them. Artist specs drive this fake through
    // `POST /__artist-mock/set` instead (see fake-artist-api-server.ts).
    {
      command: 'node e2e/fake-artist-api-server.ts',
      url: 'http://127.0.0.1:3333/__health',
      reuseExistingServer: false,
      stdout: 'pipe',
      timeout: 30_000,
    },
  ],
});
