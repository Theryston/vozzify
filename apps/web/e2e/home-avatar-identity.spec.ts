import { expect, test } from '@playwright/test';
import { STORED_IMAGE } from './edit-profile-helpers';
import { setHomeMock } from './fake-home-api';
import {
  circularHero,
  installHomeMock,
  restoreHomeMocks,
} from './home-circular-fixtures';

test.afterAll(restoreHomeMocks);

test('each Home People card links to its own Profile with its own picture and marks', async ({
  page,
}) => {
  const states = [
    { pro: false, admin: false },
    { pro: true, admin: false },
    { pro: false, admin: true },
    { pro: true, admin: true },
  ];
  const items = states.flatMap((state, index) =>
    [null, STORED_IMAGE].map((image, position) => {
      const id = `singer-${index}-${position}`;
      return {
        id,
        name: id,
        username: id,
        commonTracks: 3,
        image,
        avatarIdentity: state,
      };
    }),
  );
  const lead = 'home-avatar-identity-hero';
  await installHomeMock(
    {
      feeds: {
        en: [
          circularHero(lead, 'Studio'),
          {
            id: 'home-avatar-identity',
            layout: 'people',
            title: { key: 'home.rows.peopleWhoSingWhatYouSing', params: {} },
            items,
          },
        ],
      },
    },
    lead,
  );
  await page.clock.install();
  await page.goto('/en');
  for (const person of items) {
    const link = page.getByRole('link', { name: new RegExp(person.name) });
    await expect(link).toHaveAttribute('href', `/en/users/${person.username}`);
    await expect(link.getByText('Pro', { exact: true })).toHaveCount(
      Number(person.avatarIdentity.pro),
    );
    await expect(link.getByText('Admin', { exact: true })).toHaveCount(
      Number(person.avatarIdentity.admin),
    );
    if (person.image) await expect(link.locator('img')).toBeVisible();
    else await expect(link.getByText('S', { exact: true })).toBeVisible();
  }
  // Expiry is reflected while the same Home visit stays open.
  await setHomeMock({
    feeds: {
      en: [
        circularHero(lead, 'Studio'),
        {
          id: 'home-avatar-identity',
          layout: 'people',
          title: { key: 'home.rows.peopleWhoSingWhatYouSing', params: {} },
          items: items.map((person) => ({
            ...person,
            avatarIdentity: { ...person.avatarIdentity, pro: false },
          })),
        },
      ],
    },
  });
  await page.clock.fastForward(61_000);
  const updated = page.getByRole('link', { name: /singer-3-0/ });
  await expect(updated.getByText('Pro', { exact: true })).toHaveCount(0);
  await expect(updated.getByText('Admin', { exact: true })).toBeVisible();
});
