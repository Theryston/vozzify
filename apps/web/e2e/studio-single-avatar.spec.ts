import { expect, type Locator, test } from '@playwright/test';
import sharp from 'sharp';
import { ADA, mockAuthApi } from './auth-api-mock';
import { openAsAda, pickPng, summaryImage } from './edit-profile-helpers';
import { setTrackMock } from './fake-track-api';
import { mockFollowLists } from './follow-lists-api-mock';
import { messages } from './messages';
import { subscriptionFixture } from './subscription-fixture';

async function capture(name: string, element: Locator) {
  await test.info().attach(name, {
    body: await element.screenshot(),
    contentType: 'image/png',
  });
}

for (const width of [360, 1280]) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`the public sleeve and account trigger describe their own User at ${width}px in ${colorScheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme });
      await page.setViewportSize({ width, height: 840 });
      await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
      await page.route('**/v1/me/subscription?*', (route) =>
        route.fulfill({ json: { subscription: subscriptionFixture() } }),
      );
      await page.goto('/en/users/studio_admin');
      const banner = page.getByRole('region', {
        name: 'Lia Costa',
        exact: true,
      });
      await expect(banner.getByText('LC', { exact: true })).toBeVisible();
      await expect(
        banner.getByText('Pro', { exact: true }).first(),
      ).toBeVisible();
      await expect(banner.getByText('Admin', { exact: true })).toBeVisible();
      if (width === 360) {
        const artwork = await banner
          .getByText('LC', { exact: true })
          .boundingBox();
        const name = await banner.getByRole('heading').boundingBox();
        const box = await banner.boundingBox();
        if (!artwork || !name || !box)
          throw new Error('Profile layout unavailable');
        expect(artwork.y).toBeGreaterThan(box.y);
        expect(artwork.y + artwork.height).toBeLessThan(name.y);
      }
      const trigger = page.getByRole('button', {
        name: messages.en.header.account.accountMenu,
      });
      await expect(trigger).toHaveAccessibleDescription('Pro');
      await capture('profile', banner);
      await capture('trigger', trigger);
      await trigger.click();
      const menu = page.getByRole(width === 360 ? 'dialog' : 'menu');
      await expect(menu).toContainText('Ada Lovelace');
      await expect(menu.getByText('Pro', { exact: true })).toBeVisible();
      await capture('account', menu);
    });

    test(`a mixed follower list shows marks at ${width}px in ${colorScheme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 840 });
      await page.emulateMedia({ colorScheme });
      const person = {
        name: 'Lia Costa',
        username: 'lia',
        image: null,
        id: 'lia',
        avatarIdentity: { admin: true, pro: true },
      };
      await mockAuthApi(page, { user: null });
      await mockFollowLists(page, {
        username: 'follow_target',
        lists: {
          followers: [
            person,
            { id: 'sam', name: 'Sam', username: 'sam', image: null },
          ],
          following: [],
          friends: [],
        },
      });
      await page.goto('/en/users/follow_target');
      await page
        .getByRole('list', { name: messages.en.publicProfile.follow.label })
        .getByRole('button')
        .first()
        .click();
      const profile = page
        .getByRole('dialog')
        .getByRole('link', { name: /Lia Costa/ });
      await expect(profile.getByText('Admin')).toBeVisible();
      await expect(profile.getByText('Pro')).toBeVisible();
      await capture('followers', profile);
      await expect(
        page.getByRole('dialog').getByRole('link', { name: /Sam/ }),
      ).not.toContainText('Pro');
    });
  }
}

for (const username of ['studio_admin', 'studio_portrait']) {
  test(`the generated share image contains the exposed black record for ${username}`, async ({
    page,
    request,
  }) => {
    await page.goto(`/en/users/${username}`);
    const url = await page
      .locator('meta[property="og:image"]')
      .getAttribute('content');
    if (!url) throw new Error('Missing share image URL');
    const response = await request.get(new URL(url).pathname);
    expect(response.ok()).toBe(true);
    const png = await response.body();
    await test.info().attach(username, { body: png, contentType: 'image/png' });
    const image = sharp(png);
    expect(await image.metadata()).toMatchObject({ width: 1200, height: 630 });
    // The fixture is teal, while the initials sleeve has orange artwork.
    const artwork = await image
      .clone()
      .extract({ left: 810, top: 255, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    expect([...artwork]).toEqual(
      username === 'studio_portrait' ? [20, 160, 183] : [250, 73, 0],
    );
    // The right edge of the exposed record is dark in both artwork states.
    const region = await image
      .extract({ left: 1090, top: 299, width: 12, height: 24 })
      .raw()
      .toBuffer();
    expect(region[0]).toBeLessThan(100);
    expect(region[1]).toBeLessThan(100);
    expect(region[2]).toBeLessThan(100);
  });
}

test('a Pro editor previews an unsaved photo inside the same sleeve', async ({
  page,
}) => {
  await page.route('**/v1/me/subscription?*', (route) =>
    route.fulfill({ json: { subscription: subscriptionFixture() } }),
  );
  const saves = await openAsAda(page);
  const main = page.getByRole('main');
  await expect(main.getByText('Pro', { exact: true }).first()).toBeVisible();
  await expect(main.getByText('AL', { exact: true })).toBeVisible();
  await pickPng(page);
  await expect(summaryImage(page)).toHaveAttribute('src', /^blob:/);
  await expect(summaryImage(page)).toBeVisible();
  await expect(main.getByText('AL', { exact: true })).toHaveCount(0);
  expect(saves).toHaveLength(0);
});

test('a failed photo returns to the initials on the public record sleeve', async ({
  page,
}) => {
  await page.goto('/en/users/studio_missing');
  const banner = page.getByRole('region', { name: 'Lia Costa' });
  await expect(banner.getByText('LC', { exact: true })).toBeVisible();
  await expect(banner.getByText('Pro', { exact: true }).first()).toBeVisible();
});

test('the contributor credit offers a working link for the displayed Admin', async ({
  page,
}) => {
  const person = {
    id: 'studio-contributor',
    username: 'studio_admin',
    name: 'Lia Costa',
    image: null,
    avatarIdentity: { admin: true },
  };
  const id = 'studio-identity-credit';
  await setTrackMock({
    tracks: [
      {
        id,
        title: 'Studio credit',
        processing: { status: 'QUEUED' },
        contributors: [person],
      },
    ],
  });
  await page.goto(`/en/tracks/${id}`);
  const link = page.getByRole('link', { name: /Lia Costa/ });
  await expect(link.getByText('Admin')).toBeVisible();
  await expect(link.getByText('Pro')).toHaveCount(0);
  await link.click();
  await expect(page.getByRole('heading', { name: 'Lia Costa' })).toBeVisible();
});
