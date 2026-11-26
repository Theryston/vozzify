import { expect, test } from '@playwright/test';
import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';

test('shows timed lyrics in private practice', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Expected the web server URL');
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.context().addCookies([{ ...SIGNED_IN_COOKIE, url: baseURL }]);
  await setPrivateTrackMock({
    id: 'private_lyrics',
    ownerId: ADA.id,
    title: 'Rehearsal',
    artist: '',
    createdAt: '2026-11-25T12:00:00.000Z',
    durationMs: 10_000,
    processing: { status: 'COMPLETED', progress: 100 },
    notes: [{ pitch: 69, start: 1, end: 2 }],
    locked: false,
    lyrics: {
      lines: [
        { start: 1, end: 2, words: [{ text: 'Sing', start: 1, end: 2 }] },
      ],
    },
  });
  await page.goto('/en/tracks/private_lyrics');
  await expect(
    page.getByRole('button', { name: 'Sing', exact: true }),
  ).toBeVisible();
});
