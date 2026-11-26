import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { PrivateTrackDetail } from '@vozzify/contracts';
import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';
import { messages } from './messages';

const fixture = fileURLToPath(
  new URL('../../api/test/fixtures/private-rehearsal.mp4', import.meta.url),
);
const detail: PrivateTrackDetail = {
  id: 'private_video_rehearsal',
  title: 'Filmed rehearsal',
  artist: '',
  durationMs: 30_000,
  createdAt: '2026-11-24T12:00:00.000Z',
  ownerId: ADA.id,
  locked: false,
  processing: { status: 'COMPLETED', progress: 100 },
  notes: [{ pitch: 69, start: 0.1, end: 0.3 }],
};

test('explains missing video audio and practices with the extracted audio from a filmed rehearsal', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Expected the web server URL');
  const t = messages.en.privateTracks;
  let uploaded = false;
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.context().addCookies([{ ...SIGNED_IN_COOKIE, url: baseURL }]);
  await setPrivateTrackMock(detail);
  await page.route(
    (url) => url.pathname === '/v1/me/private-tracks',
    (route) => {
      const headers = {
        'access-control-allow-origin': baseURL,
        'access-control-allow-credentials': 'true',
      };
      if (route.request().method() === 'POST') {
        if (route.request().postDataBuffer()?.includes('silent.mp4')) {
          return route.fulfill({
            status: 400,
            headers,
            json: {
              statusCode: 400,
              code: 'VALIDATION_FAILED',
              message: 'Video must contain an audio track',
              details: {
                location: 'body',
                issues: [
                  {
                    code: 'custom',
                    path: ['audio'],
                    params: { reason: 'MISSING_VIDEO_AUDIO' },
                  },
                ],
              },
            },
          });
        }
        expect(route.request().postDataBuffer()?.toString('latin1')).toContain(
          'filename="private-rehearsal.mp4"',
        );
        uploaded = true;
        return route.fulfill({ status: 201, headers, json: detail });
      }
      return route.fulfill({
        headers,
        json: {
          canSubmit: true,
          items: uploaded ? [detail] : [],
          nextCursor: null,
        },
      });
    },
  );
  await page.goto('/en/me/tracks');
  await page.getByRole('button', { name: t.newTrack }).click();
  const dialog = page.getByRole('dialog', { name: t.newTrack });
  const picker = dialog.getByLabel(t.chooseAudio);
  await expect(picker).toHaveAttribute('accept', 'audio/*,video/*');
  await picker.setInputFiles({
    name: 'silent.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.from('video without audio'),
  });
  await dialog.getByRole('button', { name: t.upload }).click();
  await expect(dialog.getByRole('alert')).toHaveText(t.missingVideoAudio);

  await picker.setInputFiles(fixture);
  await dialog.getByRole('button', { name: t.upload }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('link', { name: detail.title }).click();

  await expect(page.getByText(t.detail.privateBadge)).toBeVisible();
  await expect(
    page.getByRole('img', { name: /Filmed rehearsal/ }),
  ).toBeVisible();
  const { dock } = messages.en.tracks.practice;
  const progress = page.getByRole('slider', { name: dock.progress });
  const before = Number(await progress.getAttribute('aria-valuenow'));
  await page.getByRole('button', { name: dock.play }).click();
  await expect
    .poll(async () => Number(await progress.getAttribute('aria-valuenow')))
    .toBeGreaterThan(before);
});
