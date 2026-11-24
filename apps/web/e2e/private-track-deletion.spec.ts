import { expect, test } from '@playwright/test';
import { ADA, mockAuthApi } from './auth-api-mock';
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
