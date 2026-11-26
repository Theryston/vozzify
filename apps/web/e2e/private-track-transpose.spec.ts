import { expect, test } from '@playwright/test';
import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';
import { messages } from './messages';

const { dock } = messages.en.tracks.practice;

for (const source of ['upload', 'youtube']) {
  test(`shows the original and transposed key for a private ${source} track`, async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('Expected the web server URL');
    const id = `private_transpose_${source}`;
    await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
    await page.context().addCookies([{ ...SIGNED_IN_COOKIE, url: baseURL }]);
    await setPrivateTrackMock({
      id,
      ownerId: ADA.id,
      title: 'Rehearsal',
      artist: '',
      ...(source === 'youtube' ? { youtubeVideoId: 'aBcd1Efgh_2' } : {}),
      durationMs: 10000,
      createdAt: '2026-11-26T12:00:00.000Z',
      processing: { status: 'COMPLETED', progress: 100 },
      locked: false,
      notes: [{ pitch: 67, start: 0, end: 1 }],
      key: { tonic: 7, mode: 'MAJOR' },
    });
    await page.goto(`/en/tracks/${id}`);
    const chip = (key: string) =>
      page.getByRole('button', {
        name: dock.transposeOpen.replace('{key}', key),
      });
    await chip('G major').click();
    await expect(page.getByTestId('transpose-key')).toHaveText('G major');
    await page.getByRole('button', { name: dock.transposeUp }).click();
    await expect(page.getByTestId('transpose-key')).toHaveText('G# major');
    await expect(chip('G# major')).toBeVisible();
  });
}
