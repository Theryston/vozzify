import { expect, test } from '@playwright/test';
import type { PrivateTrackDetail } from '@vozzify/contracts';

import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';
import { messages } from './messages';

const detail: PrivateTrackDetail = {
  id: 'private_layout',
  ownerId: ADA.id,
  title: 'Evening rehearsal recording with a long file name.webm',
  artist: '',
  durationMs: 30_000,
  createdAt: '2026-11-24T12:00:00.000Z',
  locked: false,
  processing: { status: 'DETECTING_NOTES', progress: 70 },
  notes: [],
};

test('shows the localized file picker and shared processing banner on a phone', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Expected the web server URL');
  const { privateTracks, tracks } = messages['pt-BR'];
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.context().addCookies([{ ...SIGNED_IN_COOKIE, url: baseURL }]);
  await setPrivateTrackMock(detail);
  await page.route(
    (url) => url.pathname === '/v1/me/private-tracks',
    (route) =>
      route.fulfill({
        headers: {
          'access-control-allow-origin': new URL(baseURL).origin,
          'access-control-allow-credentials': 'true',
        },
        json: { items: [detail], canSubmit: true, nextCursor: null },
      }),
  );

  await page.goto('/pt-BR/me/tracks');
  await page.getByRole('button', { name: privateTracks.newTrack }).click();
  const dialog = page.getByRole('dialog', { name: privateTracks.newTrack });
  await expect(
    dialog.getByRole('button', { name: privateTracks.chooseAudio }),
  ).toBeVisible();
  await dialog.getByLabel(privateTracks.chooseAudio).setInputFiles({
    name: 'Ensaio.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('audio'),
  });
  await expect(dialog.getByText('Ensaio.wav')).toBeVisible();
  await dialog.getByRole('button', { name: privateTracks.close }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('link', { name: detail.title }).click();

  const banner = page.getByRole('region', { name: detail.title });
  const ring = banner.getByRole('progressbar', {
    name: tracks.processing.progress.label,
  });
  await expect(ring).toHaveAttribute('aria-valuenow', '70');
  await expect(
    banner.getByText(privateTracks.detail.privateBadge),
  ).toBeVisible();
  const steps = banner.getByRole('list', {
    name: tracks.processing.steps.label,
  });
  await expect(steps.getByRole('listitem')).toHaveCount(2);
  await expect(steps.getByRole('listitem').first()).toHaveAttribute(
    'data-state',
    'done',
  );
  await expect(steps.getByRole('listitem').last()).toHaveAttribute(
    'data-state',
    'current',
  );
  await expect(page.getByRole('status')).toContainText(
    privateTracks.detail.closeNote,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    360,
  );
});
