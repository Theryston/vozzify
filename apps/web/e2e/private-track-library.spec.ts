import { expect, test } from '@playwright/test';
import type { PrivateTrack } from '@vozzify/contracts';

import { ADA, mockAuthApi } from './auth-api-mock';
import { messages } from './messages';

const recording: PrivateTrack = {
  id: 'private_library_failed',
  title: 'Ensaio vocal_Take03_20261125211349_GravacaoCompleta.webm',
  artist: '',
  durationMs: 188_000,
  createdAt: '2026-11-24T12:00:00.000Z',
  processing: { status: 'FAILED', progress: 0 },
};

test('keeps the upload in the header and recording metadata readable on a phone', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Expected the web server URL');
  const t = messages['pt-BR'].privateTracks;
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.route(
    (url) => url.pathname === '/v1/me/private-tracks',
    (route) =>
      route.fulfill({
        headers: {
          'access-control-allow-origin': new URL(baseURL).origin,
          'access-control-allow-credentials': 'true',
        },
        json: { items: [recording], canSubmit: true, nextCursor: null },
      }),
  );

  await page.goto('/pt-BR/me/tracks');
  const header = page.locator('main header');
  const upload = header.getByRole('button', { name: t.newTrack });
  const row = page.getByRole('link', { name: new RegExp(recording.title) });
  const title = row.getByText(recording.title, { exact: true });
  const status = row.getByText(t.detail.processing.FAILED);
  await expect(header.getByRole('heading', { name: t.title })).toBeVisible();
  await expect(upload).toBeEnabled();
  await expect(row.getByText('3:08', { exact: true })).toBeVisible();
  const desktopTitle = await title.boundingBox();
  const desktopStatus = await status.boundingBox();
  if (!desktopTitle || !desktopStatus)
    throw new Error('Expected a visible row');
  expect(desktopStatus.x).toBeGreaterThan(desktopTitle.x + desktopTitle.width);

  await page.setViewportSize({ width: 360, height: 800 });
  const phoneTitle = await title.boundingBox();
  const phoneStatus = await status.boundingBox();
  if (!phoneTitle || !phoneStatus) throw new Error('Expected a visible row');
  expect(phoneStatus.y).toBeGreaterThanOrEqual(
    phoneTitle.y + phoneTitle.height,
  );
  expect(
    await title.evaluate((element) => element.scrollWidth),
  ).toBeLessThanOrEqual(Math.ceil(phoneTitle.width));
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    360,
  );
});
