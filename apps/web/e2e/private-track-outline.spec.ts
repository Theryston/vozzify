import { expect, test } from '@playwright/test';
import type { PrivateTrackDetail } from '@vozzify/contracts';

import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';
import { messages } from './messages';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`matches the banner outline on a private track in ${colorScheme} mode`, async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('Expected the web server URL');
    const track: PrivateTrackDetail = {
      id: `private_outline_${colorScheme}`,
      ownerId: ADA.id,
      title: 'Private rehearsal',
      artist: '',
      durationMs: 10_000,
      createdAt: '2026-11-24T12:00:00.000Z',
      locked: false,
      processing: {
        status: colorScheme === 'dark' ? 'FAILED' : 'DETECTING_NOTES',
        progress: 0,
      },
      notes: [],
    };
    const t = messages['pt-BR'].privateTracks;
    await page.emulateMedia({ colorScheme });
    await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
    await page.context().addCookies([{ ...SIGNED_IN_COOKIE, url: baseURL }]);
    await setPrivateTrackMock(track);

    await page.goto(`/pt-BR/tracks/${track.id}`);
    const banner = page.getByRole('region', { name: track.title });
    const remove = banner.getByRole('button', { name: t.delete });
    const badge = banner.getByText(t.detail.privateBadge);
    const borderColor = await badge.evaluate(
      (element) => getComputedStyle(element).borderTopColor,
    );

    await expect(remove).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(remove).toHaveCSS('border-top-width', '1px');
    await expect(remove).toHaveCSS('border-top-color', borderColor);
  });
}
