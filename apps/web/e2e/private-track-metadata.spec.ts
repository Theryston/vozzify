import { expect, test } from '@playwright/test';
import {
  PRIVATE_TRACK_METADATA_MAX_LENGTH,
  type PrivateTrackDetail,
  type SearchResultItem,
} from '@vozzify/contracts';
import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';
import { messages } from './messages';

const original = {
  mbid: '00000000-0000-4000-8000-000000005531',
  title: 'Noite de Samba (estúdio)',
  artist: 'Trio do Bairro',
  coverUrl: null,
};
const replacement: SearchResultItem = {
  mbid: '00000000-0000-4000-8000-000000005532',
  title: 'Noite de Samba (ao vivo)',
  artistCredit: 'Trio do Bairro',
  coverUrl: null,
  trackId: 'public-live-track',
};
const legacyArtist = `${original.artist} ${'x'.repeat(PRIVATE_TRACK_METADATA_MAX_LENGTH)}`;

const detail: PrivateTrackDetail = {
  id: 'private_recording_metadata',
  ownerId: ADA.id,
  title: original.title,
  artist: legacyArtist,
  recording: original,
  durationMs: 150_000,
  createdAt: '2026-11-24T12:00:00.000Z',
  locked: false,
  processing: { status: 'COMPLETED', progress: 100 },
  notes: [{ pitch: 64, start: 0.4, end: 1.2 }],
};

test('corrects and unlinks a private Recording while playback continues', async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error('Expected the web server URL');
  const { metadata: t } = messages.en.privateTracks;
  const { dock } = messages.en.tracks.practice;
  const detailPath = `/v1/me/private-tracks/${detail.id}`;
  const headers = {
    'access-control-allow-origin': baseURL,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, PATCH, OPTIONS',
  };
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.context().addCookies([{ ...SIGNED_IN_COOKIE, url: baseURL }]);
  await setPrivateTrackMock(detail);
  let current = detail;
  let updates = 0;
  await page.route(
    (url) => url.pathname === detailPath,
    (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ status: 204, headers });
      if (route.request().method() === 'PATCH') {
        updates += 1;
        const body: unknown = route.request().postDataJSON();
        if (updates === 1) {
          expect(body).toEqual({
            title: 'Meu ensaio',
            recordingMbid: replacement.mbid,
          });
          current = {
            ...current,
            title: 'Meu ensaio',
            recording: {
              mbid: replacement.mbid,
              title: replacement.title,
              artist: replacement.artistCredit,
              coverUrl: null,
            },
          };
        } else {
          expect(body).toEqual({ artist: '', recordingMbid: null });
          current = { ...current, artist: '', recording: undefined };
        }
      }
      return route.fulfill({ headers, json: current });
    },
  );
  let searchRateLimited = true;
  await page.route(
    (url) =>
      url.pathname === '/v1/search' &&
      url.searchParams.get('query') === 'Noite de Samba',
    (route) =>
      searchRateLimited
        ? route.fulfill({
            status: 429,
            headers,
            json: {
              statusCode: 429,
              code: 'RATE_LIMITED',
              message: 'Search rate limit reached',
            },
          })
        : route.fulfill({
            headers,
            json: { results: [replacement], source: 'music-catalog' },
          }),
  );

  await page.goto(`/en/tracks/${detail.id}`);
  await expect(
    page.getByRole('heading', { name: original.title }),
  ).toBeVisible();
  const play = page.getByRole('button', { name: dock.play, exact: true });
  const pause = page.getByRole('button', { name: dock.pause, exact: true });
  await play.click();
  await expect(pause).toBeVisible();
  const edit = page.getByRole('button', { name: t.edit });
  const dialog = page.getByRole('dialog', { name: t.edit });
  await edit.click();
  await expect(
    dialog.getByText(original.title, { exact: false }),
  ).toBeVisible();
  const titleField = dialog.getByLabel(t.title);
  await titleField.evaluate((input) => input.removeAttribute('maxlength'));
  await titleField.fill('x'.repeat(PRIVATE_TRACK_METADATA_MAX_LENGTH + 1));
  await dialog.getByRole('button', { name: t.save }).click();
  await expect(dialog.getByText(t.invalidText)).toBeVisible();
  expect(updates).toBe(0);
  await titleField.fill('Meu ensaio');
  await dialog.getByLabel(t.searchLabel).fill('Noite de Samba');
  await dialog.getByRole('button', { name: t.search }).click();
  await expect(dialog.getByRole('alert')).toHaveText(t.searchError);
  searchRateLimited = false;
  await dialog.getByRole('button', { name: t.search }).click();
  await dialog
    .getByRole('button', {
      name: `${replacement.title} ${replacement.artistCredit}`,
    })
    .click();
  await dialog.getByRole('button', { name: t.save }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Meu ensaio' })).toBeVisible();
  await expect(pause).toBeVisible();

  await edit.click();
  await expect(
    dialog.getByText(replacement.title, { exact: false }),
  ).toBeVisible();
  await expect(dialog.getByLabel(t.artist)).toHaveValue(legacyArtist);
  await dialog.getByLabel(t.artist).fill('');
  await dialog.getByRole('button', { name: t.unlink }).click();
  await dialog.getByRole('button', { name: t.save }).click();
  await expect(dialog).toBeHidden();
  await expect(pause).toBeVisible();
  await edit.click();
  await expect(dialog.getByText(t.noRecording)).toBeVisible();
  await expect(dialog.getByRole('button', { name: t.unlink })).toHaveCount(0);
});
