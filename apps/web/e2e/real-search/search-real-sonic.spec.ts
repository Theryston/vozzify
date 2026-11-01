import { expect, test } from '@playwright/test';
import { mockAuthApi } from '../auth-api-mock';

const API_URL = 'http://127.0.0.1:4336';

test('restarts pagination on a real API Sonic fallback and links its Track', async ({
  page,
}) => {
  await mockAuthApi(page);
  const offsets: string[] = [];
  let catalogPageServed = false;
  await page.route('**/v1/search**', async (route) => {
    const requestUrl = new URL(route.request().url());
    const offset = requestUrl.searchParams.get('offset') ?? '0';
    offsets.push(offset);
    if (offset === '0' && !catalogPageServed) {
      catalogPageServed = true;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          source: 'music-catalog',
          results: Array.from({ length: 20 }, (_, index) => ({
            mbid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
            title: `Catalog song ${index + 1}`,
            artistCredit: 'Catalog artist',
            coverUrl: null,
            trackId: null,
          })),
        }),
      });
      return;
    }
    const response = await route.fetch({
      url: `${API_URL}${new URL(route.request().url()).pathname}${new URL(route.request().url()).search}`,
    });
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'access-control-allow-origin': 'http://localhost:3000',
        'access-control-allow-credentials': 'true',
      },
    });
  });

  await page.goto('/en/search?q=bohemian');
  const main = page.getByRole('main');
  await expect(
    main.getByText('Catalog song 20', { exact: true }),
  ).toBeVisible();
  await main
    .getByText('Catalog song 20', { exact: true })
    .scrollIntoViewIfNeeded();

  await expect(
    main.getByText('Bohemian Rhapsody', { exact: true }),
  ).toBeVisible();
  await expect(main.getByText('Catalog song 20', { exact: true })).toHaveCount(
    0,
  );
  await expect(
    main.getByRole('link', { name: /Bohemian Rhapsody/ }),
  ).toHaveAttribute('href', /\/tracks\/seedtrack01/);
  expect(offsets).toEqual(['0', '20', '0']);
});
