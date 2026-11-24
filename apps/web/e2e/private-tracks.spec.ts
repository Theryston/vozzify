import { expect, type Page, test } from '@playwright/test';
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
const olderTrack = {
  ...track,
  id: 'private_older',
  title: 'Older track',
};

async function mockPrivateTracksApi(page: Page, canSubmit: boolean) {
  const entries: (typeof track)[] = [];
  let loadedOlder = false;
  await page.route('**/v1/me/private-tracks**', async (route) => {
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
      if (!entries.some((entry) => entry.id === created.id)) {
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
  });
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
  await page.getByLabel('Choose an audio file').setInputFiles({
    name: 'source.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('audio'),
  });
  await page.getByRole('button', { name: 'Add audio' }).click();
  await expect(page.getByText('Tagged song')).toBeVisible();
  await expect(page.getByText('Tagged artist')).toBeVisible();
  await page.getByLabel('Choose an audio file').setInputFiles({
    name: 'source.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('audio'),
  });
  await page.getByRole('button', { name: 'Add audio' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  expect(consoleErrors.join('\n')).not.toContain('same key');
  await page.getByRole('button', { name: 'Load more' }).click();
  await expect(page.getByText('Older track')).toBeVisible();
  await page.getByLabel('Choose an audio file').setInputFiles({
    name: 'source.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('audio'),
  });
  await page.getByRole('button', { name: 'Add audio' }).click();
  await expect(page.getByRole('listitem')).toHaveCount(2);
  expect(consoleErrors.join('\n')).not.toContain('same key');
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
    ownerId: ADA.id,
    locked: false,
    processing: { status: 'QUEUED' as const, progress: 0 },
    notes: [],
  };
  await setPrivateTrackMock(detail);
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.context().addCookies([
    { ...SIGNED_IN_COOKIE, url: 'http://localhost:3000' },
    { ...SIGNED_IN_COOKIE, url: 'http://127.0.0.1:3333' },
  ]);
  await mockPrivateTracksApi(page, true);
  let detailReads = 0;
  await page.route('**/v1/me/private-tracks/private_1', async (route) => {
    detailReads += 1;
    const processing =
      detailReads === 1
        ? { status: 'DETECTING_NOTES', progress: 70 }
        : { status: 'COMPLETED', progress: 100 };
    await route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': 'http://localhost:3000',
        'access-control-allow-credentials': 'true',
        'cache-control': 'private, no-store',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...detail,
        processing,
        notes:
          processing.status === 'COMPLETED'
            ? [{ pitch: 69, start: 0.1, end: 0.3 }]
            : [],
      }),
    });
  });
  await page.goto('/en/me/tracks');
  await page.getByLabel('Choose an audio file').setInputFiles({
    name: 'source.wav',
    mimeType: 'audio/wav',
    buffer: Buffer.from('audio'),
  });
  await page.getByRole('button', { name: 'Add audio' }).click();
  await expect(page.getByRole('link', { name: /Tagged song/ })).toHaveAttribute(
    'href',
    '/en/tracks/private_1',
  );
  await page.getByRole('link', { name: /Tagged song/ }).click();

  await expect(page.getByText('Private · only you')).toBeVisible();
  await expect(page.getByText('Detecting notes')).toBeVisible();
  await expect(page.getByText('Ready to practice')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.locator('audio')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('keeps private metadata visible while locked and refreshes membership at the route', async ({
  page,
}) => {
  const detail = {
    ...track,
    id: 'private_locked',
    ownerId: ADA.id,
    locked: false,
    processing: { status: 'COMPLETED' as const, progress: 100 },
    notes: [{ pitch: 69, start: 0.1, end: 0.3 }],
  };
  await setPrivateTrackMock(detail);
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.context().addCookies([
    { ...SIGNED_IN_COOKIE, url: 'http://localhost:3000' },
    { ...SIGNED_IN_COOKIE, url: 'http://127.0.0.1:3333' },
  ]);
  let detailReads = 0;
  await page.route('**/v1/me/private-tracks/private_locked', async (route) => {
    detailReads += 1;
    await route.fulfill({
      status: 200,
      headers: {
        'access-control-allow-origin': 'http://localhost:3000',
        'access-control-allow-credentials': 'true',
        'cache-control': 'private, no-store',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        ...detail,
        locked: detailReads > 1,
      }),
    });
  });
  await page.goto('/en/tracks/private_locked');

  await expect(page.getByText('Private · only you')).toBeVisible();
  await expect(page.getByText('Ready to practice')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('heading', { name: 'This private track is locked' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Reactivate Pro' }),
  ).toHaveAttribute('href', '/en/plans');
});
