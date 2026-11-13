import { expect, test } from '@playwright/test';
import { defaultHomeRows, setHomeMock } from './fake-home-api';
import {
  adSlotURL,
  consent,
  feedRows,
  installFeed,
  observeAdRequests,
  observeCmpRequests,
  observeSlotRequests,
  setAdProvider,
  setCmp,
  setSession,
  setSubscription,
} from './home-ads-fixtures';
import { messages } from './messages';

test.beforeEach(async () => {
  await installFeed(feedRows(12));
});

test.afterAll(async () => {
  await setHomeMock({
    feeds: { en: defaultHomeRows('en'), 'pt-BR': defaultHomeRows('pt-BR') },
  });
});

test('serves the publisher authorization file without locale redirect', async ({
  page,
}) => {
  const response = await page.goto('/ads.txt');
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/ads\.txt$/);
  await expect(page.locator('body')).toHaveText(
    'google.com, pub-9375786333422765, DIRECT, f08c47fec0942fa0',
  );
});

test('skips unknown layouts when counting rendered Rows for placements', async ({
  page,
}) => {
  const rows = feedRows(6);
  const unsupported = rows[2];
  if (!unsupported) throw new Error('Expected a Home Row fixture');
  rows[2] = { ...unsupported, layout: 'unknown-layout' };
  await installFeed(rows);
  await setSession(page, false);
  await setCmp(page, consent);
  await setAdProvider(page);
  const adRequests = observeAdRequests(page);
  await page.goto('/en');
  await expect(page.locator('[data-home-row-id]')).toHaveCount(5);
  await expect(page.getByTestId('home-in-feed-ad')).toBeVisible();
  const rowOrder = await page
    .locator('[data-home-row-id]')
    .evaluateAll((elements) =>
      elements.map((element) => (element as HTMLElement).dataset.homeRowId),
    );
  expect(rowOrder).toEqual([
    'hero',
    'ads-row-1',
    'ads-row-3',
    'ads-row-4',
    'ads-row-5',
  ]);
  expect(adRequests.filter((url) => url.startsWith(adSlotURL))).toHaveLength(1);
});

test('keeps the CMP listener active across a Home RSC refresh', async ({
  page,
  context,
}) => {
  await setSession(page, true);
  await setSubscription(page, { subscription: null });
  await context.addCookies([
    {
      name: 'vozzify.session_token',
      value: 'signed-in',
      url: 'http://localhost:3000',
    },
  ]);
  await setCmp(page, consent);
  await setAdProvider(page);
  const cmpRequests = observeCmpRequests(page);
  const slotRequests = observeSlotRequests(page);
  await page.goto('/en');
  await expect(page.getByTestId('home-in-feed-ad').first()).toBeVisible();
  const homeRefresh = page.waitForRequest((request) =>
    new URL(request.url()).searchParams.has('_rsc'),
  );
  await page.getByRole('link', { name: messages.en.header.home }).click();
  await homeRefresh;
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator('[data-home-row-id]')).toHaveCount(12);
  await expect(page.getByTestId('home-in-feed-ad')).toHaveCount(4);
  await expect.poll(() => slotRequests.length).toBe(4);
  expect(cmpRequests).toHaveLength(1);
});
