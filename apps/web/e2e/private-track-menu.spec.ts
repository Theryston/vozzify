import { expect, test } from '@playwright/test';
import { ADA, mockAuthApi } from './auth-api-mock';
import { messages } from './messages';
import { subscriptionFixture } from './subscription-fixture';

for (const width of [360, 1280]) {
  test(`reopens the empty library offer from My tracks at ${width}px`, async ({
    page,
  }) => {
    const { header, privateTracks } = messages['pt-BR'];
    await page.setViewportSize({ width, height: 800 });
    await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
    await page.route('**/v1/me/subscription?*', (route) =>
      route.fulfill({ json: { subscription: null } }),
    );
    await page.route('**/v1/me/private-tracks?*', (route) =>
      route.fulfill({
        headers: {
          'access-control-allow-origin':
            route.request().headers().origin ?? '*',
          'access-control-allow-credentials': 'true',
        },
        json: { canSubmit: false, items: [], nextCursor: null },
      }),
    );
    const openLibrary = async () => {
      await page
        .getByRole('button', { name: header.account.accountMenu })
        .click();
      const link = page.getByRole(width === 360 ? 'button' : 'menuitem', {
        name: header.account.myTracks,
      });
      await expect(
        link.getByText(header.account.proBadge, { exact: true }),
      ).toBeVisible();
      await link.click();
    };
    await page.goto('/pt-BR/plans?from=account');
    const originalUrl = page.url();
    const libraryVisits: string[] = [];
    page.on('framenavigated', (frame) => {
      if (
        frame === page.mainFrame() &&
        new URL(frame.url()).pathname.endsWith('/me/tracks')
      ) {
        libraryVisits.push(frame.url());
      }
    });
    await openLibrary();
    const offer = page.getByRole('dialog', { name: privateTracks.proTitle });
    await expect(offer).toBeVisible();
    await expect(page).toHaveURL(originalUrl);
    await expect(
      offer.getByRole('link', { name: privateTracks.manageTrack }),
    ).toHaveCount(0);
    await offer.getByRole('button', { name: privateTracks.close }).click();
    await expect(offer).toHaveCount(0);
    await expect(page).toHaveURL(originalUrl);
    await openLibrary();
    await expect(offer).toBeVisible();
    await expect(page).toHaveURL(originalUrl);
    expect(libraryVisits).toEqual([]);
  });

  test(`hides the My tracks Pro badge while loading and for paid members at ${width}px`, async ({
    page,
  }) => {
    const { account } = messages['pt-BR'].header;
    const { promise, resolve } = Promise.withResolvers<void>();
    await page.setViewportSize({ width, height: 800 });
    await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
    await page.route('**/v1/me/subscription?*', async (route) => {
      await promise;
      await route.fulfill({ json: { subscription: subscriptionFixture() } });
    });
    await page.goto('/pt-BR');
    await page.getByRole('button', { name: account.accountMenu }).click();
    const item = page.getByRole(width === 360 ? 'button' : 'menuitem', {
      name: account.myTracks,
    });
    try {
      await expect(item).toBeVisible();
      await expect(item).toHaveText(account.myTracks);
    } finally {
      resolve();
    }
    await expect(
      page.getByRole(width === 360 ? 'link' : 'menuitem', {
        name: account.subscription,
      }),
    ).toBeVisible();
    await expect(item).toHaveText(account.myTracks);
  });
}
