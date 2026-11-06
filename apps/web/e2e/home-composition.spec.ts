import { type BrowserContext, expect, test } from '@playwright/test';

import {
  defaultHomeRows,
  type FakeHomeRow,
  setHomeMock,
} from './fake-home-api';
import { messages } from './messages';
import { webServerEnv } from './web-server-env';

const baseURL = 'http://localhost:3000';
const sessionCookie = {
  name: 'vozzify.session_token',
  value: 'signed-in',
};

const card = (id: string, title: string) => ({
  id,
  title,
  coverUrl: null,
  artistCredit: [{ name: 'Fixture Artist', joinPhrase: '' }],
  durationMs: 180_000,
  vocalRange: null,
});

const hero = (id: string): FakeHomeRow => ({
  id: 'hero',
  layout: 'hero',
  track: card(id, 'Fixture pinned lead'),
});

const dailyTarget = (
  secondsLeft = 720,
  completedToday = false,
): FakeHomeRow => ({
  id: 'daily-target',
  layout: 'daily-target',
  title: { key: 'home.rows.dailyTarget', params: {} },
  secondsLeft,
  targetSeconds: 900,
  streakDays: 5,
  completedToday,
});

const carousel = (
  id: string,
  titleKey: string,
  items: ReturnType<typeof card>[],
): FakeHomeRow => ({
  id,
  layout: 'standard',
  title: { key: titleKey, params: {} },
  items,
});

const revalidateHome = async () => {
  const response = await fetch(`${baseURL}/api/revalidate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${webServerEnv.REVALIDATE_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tags: ['home:en'] }),
  });
  expect(response.ok).toBe(true);
};

const installPersonalRows = async (rows: FakeHomeRow[]) => {
  await setHomeMock({
    feeds: {
      en: [hero('composition-public-hero')],
    },
    personal: { en: rows },
  });
  await revalidateHome();
};

const signIn = async (context: BrowserContext) => {
  await context.addCookies([{ ...sessionCookie, url: baseURL }]);
};

const renderedRowIds = (page: import('@playwright/test').Page) =>
  page
    .locator('[data-home-row-id]')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-home-row-id')),
    );

test.describe.configure({ mode: 'serial' });

test.afterAll(async () => {
  await setHomeMock({
    feeds: { en: defaultHomeRows('en'), 'pt-BR': defaultHomeRows('pt-BR') },
  });
  await revalidateHome();
});

test.describe('rendered Home composition', () => {
  test('places the Daily target after the hero and renders one-Track resume and three-Track discovery rows', async ({
    page,
    context,
  }) => {
    await installPersonalRows([
      hero('composition-pinned-hero'),
      dailyTarget(),
      carousel('continue-singing', 'home.rows.continueSinging', [
        card('composition-resume', 'Fixture one-track resume'),
      ]),
      carousel('because-you-sang', 'home.rows.trendingToday', [
        card('composition-discovery-one', 'Fixture discovery one'),
        card('composition-discovery-two', 'Fixture discovery two'),
        card('composition-discovery-three', 'Fixture discovery three'),
      ]),
    ]);
    await signIn(context);

    await page.goto('/en');

    await expect
      .poll(() => renderedRowIds(page))
      .toEqual([
        'hero',
        'daily-target',
        'continue-singing',
        'because-you-sang',
      ]);
    await expect(
      page.getByRole('link', { name: /Fixture one-track resume/ }),
    ).toBeVisible();
    await expect(
      page.locator('[data-home-row-id="continue-singing"] a'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-home-row-id="because-you-sang"] a'),
    ).toHaveCount(3);
    await expect(
      page.getByText('12 minutes left of your 15-minute goal'),
    ).toBeVisible();
  });

  test('places the Daily target first without a hero and keeps completed-day copy', async ({
    page,
    context,
  }) => {
    await installPersonalRows([
      dailyTarget(0, true),
      carousel('continue-singing', 'home.rows.continueSinging', [
        card('composition-no-hero-resume', 'Fixture no-hero resume'),
      ]),
    ]);
    await signIn(context);

    await page.goto('/en');

    await expect
      .poll(() => renderedRowIds(page))
      .toEqual(['daily-target', 'continue-singing']);
    await expect(
      page.getByText(messages.en.home.dailyTarget.completeToday),
    ).toBeVisible();
  });
});
