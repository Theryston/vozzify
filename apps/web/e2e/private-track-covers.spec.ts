import { expect, test } from '@playwright/test';
import type { PrivateTrackDetail } from '@vozzify/contracts';
import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';

const placeholder = 'span[aria-hidden="true"][class*="overflow-hidden"]';
const summary = {
  id: 'private-library-cover',
  title: 'Linked rehearsal',
  artist: 'Singer',
  createdAt: '2026-11-26T12:00:00.000Z',
  durationMs: 30_000,
};
const missingCover = 'https://assets.vozzify.com/storage/unavailable-cover.png';

test.beforeEach(async ({ page }) => {
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.route(missingCover, (route) => route.fulfill({ status: 404 }));
});

test('shows the linked cover in the library and substitutes a placeholder on failure', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Expected the web server URL');
  const coverUrl = new URL('/social-card.png', baseURL).href;
  const items = [
    { ...summary, coverUrl },
    {
      ...summary,
      id: 'missing-cover',
      title: 'Missing cover',
      coverUrl: missingCover,
    },
  ];
  await page.route(
    (url) => url.pathname === '/v1/me/private-tracks',
    (route) =>
      route.fulfill({
        headers: {
          'access-control-allow-origin': baseURL,
          'access-control-allow-credentials': 'true',
        },
        json: { items, nextCursor: null, canSubmit: true },
      }),
  );
  const failure = page.waitForResponse(missingCover);
  await page.goto('/en/me/tracks');
  const image = page
    .getByRole('link', { name: /Linked rehearsal/ })
    .locator('img');
  await expect(image).toHaveAttribute('src', coverUrl);
  await expect
    .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  expect((await failure).status()).toBe(404);
  await expect(
    page.getByRole('link', { name: /Missing cover/ }).locator(placeholder),
  ).toBeVisible();
});

for (const status of ['COMPLETED', 'DETECTING_NOTES'] as const) {
  test(`shows a placeholder when the cover of a ${status} track fails`, async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('Expected the web server URL');
    const detail: PrivateTrackDetail = {
      ...summary,
      id: `private-cover-${status}`,
      ownerId: ADA.id,
      recording: {
        mbid: '00000000-0000-4000-8000-000000000001',
        title: summary.title,
        artist: summary.artist,
        coverUrl: missingCover,
      },
      processing: { status, progress: status === 'COMPLETED' ? 100 : 50 },
      locked: false,
      notes: [],
    };
    await page.context().addCookies([{ ...SIGNED_IN_COOKIE, url: baseURL }]);
    await setPrivateTrackMock(detail);
    const failure = page.waitForResponse(missingCover);
    await page.goto(`/en/tracks/${detail.id}`);
    expect((await failure).status()).toBe(404);
    await expect(
      page.getByRole('region', { name: detail.title }).locator(placeholder),
    ).toBeVisible();
  });
}
