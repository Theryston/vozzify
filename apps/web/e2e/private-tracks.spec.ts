import { expect, type Page, test } from '@playwright/test';
import { ADA, mockAuthApi } from './auth-api-mock';
import { messages } from './messages';

const track = {
  id: 'private_1',
  title: 'Tagged song',
  artist: 'Tagged artist',
  durationMs: 1000,
  createdAt: '2026-11-24T12:00:00.000Z',
};

async function mockPrivateTracksApi(page: Page, canSubmit: boolean) {
  const entries: (typeof track)[] = [];
  await page.route('**/v1/me/private-tracks', async (route) => {
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
      entries.unshift(track);
      await route.fulfill({
        status: 201,
        headers,
        body: JSON.stringify(track),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers,
      body: JSON.stringify({ canSubmit, tracks: entries }),
    });
  });
}

test('opens My tracks from the account menu and lists a submitted file at once', async ({
  page,
}) => {
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
