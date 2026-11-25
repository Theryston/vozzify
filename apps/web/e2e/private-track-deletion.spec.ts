import { expect, test } from '@playwright/test';
import { ADA, mockAuthApi } from './auth-api-mock';
import { setPrivateTrackMock } from './fake-private-track-api';
import { SIGNED_IN_COOKIE } from './fake-track-api';
import { messages } from './messages';

test('deletes a saved private track and shows the Pro offer when its library is empty', async ({
  page,
}) => {
  const entry = {
    id: 'private_entry_1',
    title: 'Saved recording',
    artist: 'Singer',
    durationMs: 1000,
    createdAt: '2026-11-24T12:00:00.000Z',
  };
  let present = true;
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.route('**/v1/me/private-tracks**', async (route) => {
    const method = route.request().method();
    const headers = {
      'cache-control': 'private, no-store',
      'content-type': 'application/json',
    };
    if (method === 'DELETE') {
      present = false;
      await route.fulfill({ status: 204, headers });
      return;
    }
    await route.fulfill({
      status: 200,
      headers,
      body: JSON.stringify({
        canSubmit: false,
        items: present ? [entry] : [],
        nextCursor: null,
      }),
    });
  });

  await page.goto('/en');
  await page
    .getByRole('button', { name: messages.en.header.account.accountMenu })
    .click();
  await page
    .getByRole('menuitem', { name: messages.en.header.account.myTracks })
    .click();
  await expect(page).toHaveURL('/en/me/tracks');
  await expect(page.getByText('Saved recording')).toBeVisible();
  await page.getByRole('button', { name: 'Delete track' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete track' })
    .click();

  await expect(page.getByText('Saved recording')).toHaveCount(0);
  await expect(
    page.getByRole('dialog', { name: messages.en.privateTracks.proTitle }),
  ).toBeVisible();
});

test('deletes an expired locked detail and reaches the Pro offer from the account menu', async ({
  page,
}) => {
  const detail = {
    id: 'private_locked_expired',
    ownerId: ADA.id,
    title: 'Expired private recording',
    artist: 'Singer',
    durationMs: 1000,
    createdAt: '2026-11-24T12:00:00.000Z',
    locked: true,
    processing: { status: 'COMPLETED' as const, progress: 100 },
    notes: [],
  };
  await setPrivateTrackMock(detail);
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.context().addCookies([
    { ...SIGNED_IN_COOKIE, url: 'http://localhost:3000' },
    { ...SIGNED_IN_COOKIE, url: 'http://127.0.0.1:3333' },
  ]);
  let present = true;
  await page.route('**/v1/me/private-tracks**', async (route) => {
    const method = route.request().method();
    if (method === 'DELETE') {
      present = false;
      await route.fulfill({ status: 204 });
      return;
    }
    if (route.request().url().endsWith(`/${detail.id}`)) {
      await route.fulfill({
        status: present ? 200 : 404,
        contentType: 'application/json',
        body: JSON.stringify(present ? detail : { code: 'NOT_FOUND' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        canSubmit: false,
        items: present ? [detail] : [],
        nextCursor: null,
      }),
    });
  });

  await page.goto(`/en/tracks/${detail.id}`);
  await expect(
    page.getByText(messages.en.privateTracks.detail.lockedTitle),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete track' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Delete track' })
    .click();
  await expect(page).toHaveURL('/en/me/tracks');
  await expect(page.getByText(messages.en.privateTracks.empty)).toBeVisible();

  const offer = page.getByRole('dialog', {
    name: messages.en.privateTracks.proTitle,
  });
  if (await offer.isVisible()) {
    await offer
      .getByRole('button', { name: messages.en.privateTracks.close })
      .click();
  }
  await page.goto('/en');
  await page
    .getByRole('button', { name: messages.en.header.account.accountMenu })
    .click();
  await page
    .getByRole('menuitem', { name: messages.en.header.account.myTracks })
    .click();
  await expect(
    page.getByRole('dialog', { name: messages.en.privateTracks.proTitle }),
  ).toBeVisible();
});
