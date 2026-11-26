import { expect, type Page, test } from '@playwright/test';
import type { PrivateTrackDetail } from '@vozzify/contracts';
import { createTranslator } from 'next-intl';
import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';
import { messages } from './messages';

const track = {
  id: 'private_1',
  title: 'Tagged song',
  artist: 'Tagged artist',
  durationMs: 1000,
  createdAt: '2026-11-24T12:00:00.000Z',
};
const PRIVATE_FAKE_API = 'http://127.0.0.1:3333';
const olderTrack = {
  ...track,
  id: 'private_older',
  title: 'Older track',
};
const privateDetailTranslator = createTranslator({
  locale: 'en',
  messages: messages.en,
  namespace: 'tracks.practice',
});
const privateTimelineLabel = privateDetailTranslator('timeline.label', {
  title: track.title,
  count: 1,
  low: 'A4',
  high: 'A4',
});

async function mockPrivateDetail(page: Page, initial: PrivateTrackDetail) {
  let current = initial;
  await setPrivateTrackMock(current, PRIVATE_FAKE_API);
  await page.route(
    (url) => url.pathname === `/v1/me/private-tracks/${initial.id}`,
    async (route) => {
      const origin = route.request().headers().origin ?? '*';
      const headers = {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'cache-control': 'private, no-store',
        'content-type': 'application/json',
      };
      if (current.ownerId !== ADA.id) {
        await route.fulfill({
          status: 404,
          headers,
          body: JSON.stringify({
            statusCode: 404,
            code: 'NOT_FOUND',
            message: 'Private track not found',
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify(current),
      });
    },
  );
  return async (next: PrivateTrackDetail) => {
    current = next;
    await setPrivateTrackMock(current, PRIVATE_FAKE_API);
  };
}

async function refocusPrivateTrack(page: Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    window.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    window.dispatchEvent(new Event('visibilitychange'));
  });
}

async function mockPrivateTracksApi(page: Page, canSubmit: boolean) {
  const entries: (typeof track)[] = [];
  let loadedOlder = false;
  await page.route(
    (url) => url.pathname === '/v1/me/private-tracks',
    async (route) => {
      const origin = route.request().headers().origin ?? '*';
      const headers = {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'cache-control': 'private, no-store',
        'content-type': 'application/json',
      };
      if (route.request().method() === 'POST') {
        const created = loadedOlder ? olderTrack : track;
        if (!loadedOlder && !entries.some((entry) => entry.id === created.id)) {
          entries.unshift(created);
        }
        await route.fulfill({
          status: 201,
          headers,
          body: JSON.stringify(created),
        });
        return;
      }
      const cursor = new URL(route.request().url()).searchParams.get('cursor');
      loadedOlder ||= Boolean(cursor);
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          canSubmit,
          items: cursor ? [olderTrack] : entries,
          nextCursor: canSubmit && !cursor ? 'older-page' : null,
        }),
      });
    },
  );
}

async function uploadPrivateAudio(page: Page) {
  const { newTrack, chooseAudio, upload } = messages.en.privateTracks;
  await page.getByRole('button', { name: newTrack }).click();
  const dialog = page.getByRole('dialog', { name: newTrack });
  await dialog.getByLabel(chooseAudio).setInputFiles({
    name: 'source.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('audio'),
  });
  await dialog.getByRole('button', { name: upload }).click();
  await expect(dialog).toHaveCount(0);
}

test('opens My tracks from the account menu and lists a submitted file at once', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await mockPrivateTracksApi(page, true);
  await page.goto('/en');
  await page
    .getByRole('button', { name: messages.en.header.account.accountMenu })
    .click();
  await page
    .getByRole('menuitem', { name: messages.en.header.account.myTracks })
    .click();

  await expect(page).toHaveURL('/en/me/tracks');
  await expect(page.getByRole('heading', { name: 'My tracks' })).toBeVisible();
  await uploadPrivateAudio(page);
  await expect(page.getByText('Tagged song')).toBeVisible();
  await expect(page.getByText('Tagged artist')).toBeVisible();
  await uploadPrivateAudio(page);
  await expect(page.getByRole('listitem')).toHaveCount(1);
  expect(consoleErrors.join('\n')).not.toContain('same key');
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByText('Older track')).toBeVisible();
  await uploadPrivateAudio(page);
  await expect(page.getByRole('listitem')).toHaveCount(2);
  expect(consoleErrors.join('\n')).not.toContain('same key');
});

test('hydrates the account menu on a signed-in visit to My tracks', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await mockPrivateTracksApi(page, true);
  await page.goto('/en/me/tracks');
  await page
    .getByRole('button', { name: messages.en.header.account.accountMenu })
    .click();
  await expect(
    page.getByRole('menuitem', { name: messages.en.header.account.myTracks }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test('shows the localized Pro modal for a free account with no private tracks', async ({
  page,
}) => {
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await mockPrivateTracksApi(page, false);
  await page.goto('/pt-BR/me/tracks');

  await expect(
    page.getByRole('heading', { name: 'Minhas faixas' }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog', { name: 'Áudio privado é um recurso Pro' }),
  ).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Ver planos' }),
  ).toHaveAttribute('href', '/pt-BR/plans');
});

test('opens an uploaded private Track and follows processing into its notes', async ({
  page,
}) => {
  const detail = {
    ...track,
    durationMs: 30_000,
    ownerId: ADA.id,
    locked: false,
    processing: { status: 'DETECTING_NOTES' as const, progress: 70 },
    notes: [],
  };
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.context().addCookies([
    { ...SIGNED_IN_COOKIE, url: 'http://localhost:3000' },
    { ...SIGNED_IN_COOKIE, url: PRIVATE_FAKE_API },
  ]);
  const updatePrivateDetail = await mockPrivateDetail(page, detail);
  await mockPrivateTracksApi(page, true);
  await page.goto('/en/me/tracks');
  await uploadPrivateAudio(page);
  await expect(page.getByRole('link', { name: /Tagged song/ })).toHaveAttribute(
    'href',
    '/en/tracks/private_1',
  );
  await page.getByRole('link', { name: /Tagged song/ }).click();

  await expect(page.getByText('Private · only you')).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Detecting notes');
  await updatePrivateDetail({
    ...detail,
    processing: { status: 'COMPLETED', progress: 100 },
    notes: [{ pitch: 69, start: 0.1, end: 0.3 }],
  });
  await refocusPrivateTrack(page);
  const timeline = page.getByRole('img', { name: privateTimelineLabel });
  await expect(timeline).toBeVisible();
  const progress = page.getByRole('slider', {
    name: messages.en.tracks.practice.dock.progress,
  });
  const before = Number(await progress.getAttribute('aria-valuenow'));
  await page
    .getByRole('button', { name: messages.en.tracks.practice.dock.play })
    .click();
  await expect
    .poll(async () => Number(await progress.getAttribute('aria-valuenow')))
    .toBeGreaterThan(before);
  await page
    .getByRole('button', { name: messages.en.tracks.practice.dock.settings })
    .click();
  await expect(
    page.getByRole('menuitem', {
      name: messages.en.tracks.practice.dock.openOnYouTube,
    }),
  ).toHaveCount(0);
  await expect(page.locator('p[role="alert"]')).toHaveCount(0);
});

test('keeps private metadata visible while locked and refreshes membership at the route', async ({
  page,
}) => {
  const detail = {
    ...track,
    durationMs: 30_000,
    id: 'private_locked',
    ownerId: ADA.id,
    locked: false,
    processing: { status: 'COMPLETED' as const, progress: 100 },
    notes: [{ pitch: 69, start: 0.1, end: 0.3 }],
  };
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.context().addCookies([
    { ...SIGNED_IN_COOKIE, url: 'http://localhost:3000' },
    { ...SIGNED_IN_COOKIE, url: PRIVATE_FAKE_API },
  ]);
  const updatePrivateDetail = await mockPrivateDetail(page, detail);
  await page.goto('/en/tracks/private_locked');

  await expect(page.getByText('Private · only you')).toBeVisible();
  await expect(
    page.getByRole('img', { name: privateTimelineLabel }),
  ).toBeVisible();
  await updatePrivateDetail({ ...detail, locked: true });
  await refocusPrivateTrack(page);
  await expect(
    page.getByRole('heading', { name: 'This private track is locked' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Reactivate Pro' }),
  ).toHaveAttribute('href', '/en/plans');
  await updatePrivateDetail({ ...detail, locked: false });
  await refocusPrivateTrack(page);
  await expect(
    page.getByRole('img', { name: privateTimelineLabel }),
  ).toBeVisible();
  await updatePrivateDetail({ ...detail, ownerId: 'usr_other', locked: false });
  await refocusPrivateTrack(page);
  await expect(page.locator('p[role="alert"]')).toContainText(
    messages.en.privateTracks.detail.loadError,
  );
  await expect(
    page.getByRole('img', { name: privateTimelineLabel }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: messages.en.tracks.practice.dock.play }),
  ).toHaveCount(0);
});
