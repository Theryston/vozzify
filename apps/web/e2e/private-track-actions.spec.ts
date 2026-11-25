import { expect, test } from '@playwright/test';
import type { PrivateTrackDetail } from '@vozzify/contracts';

import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';
import { messages } from './messages';

const track = {
  id: 'private_saved_recording',
  title: 'Saved recording',
  artist: '',
  durationMs: 10_000,
  createdAt: '2026-11-24T12:00:00.000Z',
};

test('uploads from a dialog and leaves track deletion off the library', async ({
  page,
  baseURL,
}) => {
  const t = messages['pt-BR'].privateTracks;
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  const items = [track];
  await page.route(
    (url) => url.pathname === '/v1/me/private-tracks',
    (route) => {
      const headers = {
        'access-control-allow-origin': baseURL ?? 'http://localhost:3000',
        'access-control-allow-credentials': 'true',
      };
      if (route.request().method() === 'POST') {
        const uploaded = {
          ...track,
          id: 'private_uploaded',
          title: 'New recording',
        };
        items.unshift(uploaded);
        return route.fulfill({ status: 201, headers, json: uploaded });
      }
      return route.fulfill({
        headers,
        json: { items, canSubmit: true, nextCursor: null },
      });
    },
  );
  await page.goto('/pt-BR/me/tracks');
  const trigger = page.getByRole('button', { name: t.newTrack });
  await expect(page.getByRole('link', { name: track.title })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Faixas salvas' }),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: t.delete })).toHaveCount(0);
  await expect(page.getByLabel(t.chooseAudio)).toHaveCount(0);
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: t.newTrack });
  await dialog.getByRole('button', { name: t.upload }).click();
  await expect(dialog.getByRole('alert')).toHaveText(t.invalidAudio);
  await dialog.getByLabel(t.chooseAudio).setInputFiles({
    name: 'ensaio.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('audio'),
  });
  await dialog.getByRole('button', { name: t.upload }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole('link', { name: 'New recording' })).toBeVisible();
});

for (const status of ['DETECTING_NOTES', 'FAILED'] as const) {
  test(`keeps the compact outline delete action reachable in ${status}`, async ({
    page,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('Expected the web server URL');
    const detail: PrivateTrackDetail = {
      ...track,
      id: `private_delete_${status.toLowerCase()}`,
      ownerId: ADA.id,
      locked: false,
      notes: [],
      processing: { status, progress: status === 'FAILED' ? 0 : 70 },
    };
    const t = messages.en.privateTracks;
    await page.setViewportSize({ width: 360, height: 800 });
    await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
    await page.context().addCookies([{ ...SIGNED_IN_COOKIE, url: baseURL }]);
    await setPrivateTrackMock(detail);
    await page.goto(`/en/tracks/${detail.id}`);
    const remove = page.getByRole('button', { name: t.delete });
    await expect(remove).toHaveCSS('width', '32px');
    await expect(remove).toHaveClass(/border-foreground\/10/);
    const box = await remove.boundingBox();
    if (!box) throw new Error('Expected the compact delete button');
    await page.mouse.click(box.x - 2, box.y + box.height / 2);
    await expect(
      page.getByRole('dialog', { name: t.confirmDeleteTitle }),
    ).toBeVisible();
  });
}
