import { expect, test } from '@playwright/test';

import { ADA, mockAuthApi } from './auth-api-mock';
import { messages } from './messages';
import { mockSearchApi, searchParamsOf } from './search-api-mock';

const cases = [
  { from: 'music-catalog', to: 'sonic', locale: 'en', signedIn: false },
  { from: 'sonic', to: 'music-catalog', locale: 'pt-BR', signedIn: true },
] as const;

for (const { from, to, locale, signedIn } of cases) {
  test(`silently replaces ${from} ranking with ${to} from offset zero`, async ({
    page,
  }) => {
    await page.setViewportSize(
      signedIn ? { width: 390, height: 844 } : { width: 1280, height: 720 },
    );
    await page.emulateMedia({ colorScheme: signedIn ? 'dark' : 'light' });
    await mockAuthApi(page, {
      user: signedIn ? { ...ADA, username: 'ada' } : null,
    });
    const search = await mockSearchApi(page, {
      totalCount: 25,
      source: from,
      sourceOnNextPage: to,
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/${locale}/search?q=queen`);
    const main = page.getByRole('main');
    await expect(main.getByText('Song 20', { exact: true })).toBeVisible();

    await main.getByText('Song 20', { exact: true }).scrollIntoViewIfNeeded();
    const names = main.locator('span.truncate.font-semibold.text-sm');
    await expect(names.first()).toHaveText('Song 25');
    await expect(names.nth(1)).toHaveText('Song 24');
    expect(
      search.calls.slice(0, 3).map((request) => searchParamsOf(request).offset),
    ).toEqual(['0', '20', '0']);
    await expect(page).toHaveURL(`/${locale}/search?q=queen`);
    await expect(main.getByRole('alert')).toHaveCount(0);
    await expect(main.getByRole('combobox')).toHaveCount(0);

    await main.getByText('Song 6', { exact: true }).scrollIntoViewIfNeeded();
    await expect(names).toHaveCount(25);
    await expect(names.last()).toHaveText('Bohemian Rhapsody');
    await expect(
      main.getByRole('link', { name: /Bohemian Rhapsody/ }),
    ).toHaveAttribute('href', /\/tracks\/clxlinkedtrack01/);
    expect(
      search.calls.map((request) => searchParamsOf(request).offset),
    ).toEqual(['0', '20', '0', '20']);
    expect(errors).toEqual([]);
  });
}

test('silently restarts pages after a timed primary fallback switches source', async ({
  page,
}) => {
  await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
  await page.clock.install();
  const search = await mockSearchApi(page, {
    totalCount: 25,
    source: 'music-catalog',
    sourceOnNextPage: 'sonic',
    delayByOffsetMs: { 20: 2_100 },
  });
  await page.goto('/en/search?q=timed-fallback');
  const main = page.getByRole('main');
  await expect
    .poll(() => {
      const offsets = search.calls.map(
        (request) => searchParamsOf(request).offset,
      );
      const timedPage = offsets.indexOf('20');
      return timedPage >= 0 && offsets.slice(timedPage + 1).includes('0');
    })
    .toBe(true);
  await expect(main.getByText('Song 25', { exact: true })).toBeVisible();
  await expect(
    main.getByRole('link', { name: /Bohemian Rhapsody/ }),
  ).toHaveAttribute('href', /\/tracks\/clxlinkedtrack01/);
  await expect(main.getByRole('alert')).toHaveCount(0);

  const requestsAfterFallback = search.calls.length;
  search.source = 'music-catalog';
  await page.clock.fastForward(60_000);
  expect(search.calls).toHaveLength(requestsAfterFallback);

  let freshResponseSource: string | undefined;
  page.on('response', async (response) => {
    if (!response.url().includes('/v1/search')) return;
    const request = response.request();
    if (!request.url().includes('fresh-after-recovery')) return;
    freshResponseSource = (await response.json()).source;
  });
  await page.goto('/en/search?q=fresh-after-recovery');
  await expect
    .poll(() => search.calls.map((request) => searchParamsOf(request)))
    .toContainEqual(
      expect.objectContaining({ query: 'fresh-after-recovery', offset: '0' }),
    );
  await expect(
    main.getByText('Bohemian Rhapsody', { exact: true }),
  ).toBeVisible();
  await expect.poll(() => freshResponseSource).toBe('music-catalog');
});

test('a delayed restart cannot restore pages after the query changes', async ({
  page,
}) => {
  await mockAuthApi(page);
  const search = await mockSearchApi(page, {
    totalCount: 25,
    source: 'music-catalog',
    sourceOnNextPage: 'sonic',
    delayMs: 800,
  });
  await page.goto('/en/search?q=queen');
  const main = page.getByRole('main');
  await expect(main.getByText('Song 20', { exact: true })).toBeVisible();
  await main.getByText('Song 20', { exact: true }).scrollIntoViewIfNeeded();
  await expect
    .poll(() => search.calls.map((request) => searchParamsOf(request).offset))
    .toEqual(['0', '20', '0']);
  search.totalCount = 1;
  search.reverseResults = false;
  search.linked.title = 'Fresh query result';
  search.delayMs = 0;
  await page
    .getByRole('banner')
    .getByRole('combobox', { name: messages.en.header.search.label })
    .fill('new query');
  await expect(main.getByText('Fresh query result')).toBeVisible();
  await expect(page).toHaveURL(/q=new\+query/);
  await page.waitForTimeout(1000);
  await expect(main.getByText('Song 25', { exact: true })).toHaveCount(0);
  await expect(main.getByText('Fresh query result')).toBeVisible();
});
