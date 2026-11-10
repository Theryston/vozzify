import { type BrowserContext, expect, type Page, test } from '@playwright/test';

import { TERMS_ADVERTISING_FRAGMENT } from '../lib/terms-fragments';
import {
  defaultHomeRows,
  type FakeHomeRow,
  setHomeMock,
} from './fake-home-api';
import { messages } from './messages';
import { webServerEnv } from './web-server-env';

const baseURL = 'http://localhost:3000';

type FakeTrackCard = {
  id: string;
  title: string;
  artist: string;
};

const card = (id: string, title: string): FakeTrackCard => ({
  id,
  title,
  artist: 'Queen',
});

const toItem = ({ id, title, artist }: FakeTrackCard) => ({
  id,
  title,
  coverUrl: null,
  artistCredit: [{ name: artist, joinPhrase: '' }],
  durationMs: 354000,
  vocalRange: { lowest: 40, highest: 69 },
});

const hero = (id: string, sponsored = false): FakeHomeRow => ({
  id: 'hero',
  layout: 'hero',
  ...(sponsored ? { sponsored: true } : {}),
  track: toItem(card(id, 'Fixture lead song')),
});

const carousel = (
  id: string,
  key: string,
  cards: FakeTrackCard[],
  sponsored = false,
): FakeHomeRow => ({
  id,
  layout: 'standard',
  ...(sponsored ? { sponsored: true } : {}),
  title: { key, params: {} },
  items: cards.map(toItem),
});

// Each fixture gets its own lead Track, so `installFeed` can tell the feed it
// installed from a stale one a previous test left in the web cache.
let fixtureSeq = 0;
const uniqueId = (prefix: string): string => `${prefix}-${++fixtureSeq}`;

const trendingKey = 'home.rows.trendingToday';
const newKey = 'home.rows.newTracks';

/** A hero and eight carousels: six rows on the first page, three on the next. */
function longFeed(prefix: string): FakeHomeRow[] {
  const rows: FakeHomeRow[] = [hero(`${prefix}-hero`)];
  for (let index = 1; index <= 8; index += 1) {
    const cards = Array.from({ length: 6 }, (_, item) =>
      card(
        `${prefix}-row${index}-${item}`,
        `Fixture row ${index} song ${item}`,
      ),
    );
    if (index === 8) {
      cards[0] = card(`${prefix}-late`, 'Fixture late song');
    }
    rows.push(
      carousel(`row-${index}`, index % 2 ? trendingKey : newKey, cards),
    );
  }
  return rows;
}

/** Clears the web's cached feeds so the next visit renders the new fixture. */
async function revalidateHome(): Promise<void> {
  const response = await fetch(`${baseURL}/api/revalidate`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${webServerEnv.REVALIDATE_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tags: ['home:en', 'home:pt-BR'] }),
  });
  expect(response.ok).toBe(true);
}

type HomeFixtures = {
  en?: FakeHomeRow[];
  'pt-BR'?: FakeHomeRow[];
};

/** The id of the first Track a feed shows: the hero's, or the first card's. */
function leadTrackId(rows: FakeHomeRow[]): string {
  const [first] = rows;
  const track = first?.track as { id: string } | undefined;
  const item = (first?.items as { id: string }[] | undefined)?.[0];
  return track?.id ?? item?.id ?? '';
}

/**
 * Installs the fixtures and waits until the web serves them. A revalidated
 * tag is served stale once while it refreshes, so the page is polled until
 * its lead Track is the fixture's.
 */
async function installFeed(feeds: HomeFixtures): Promise<void> {
  await setHomeMock({ feeds });
  await revalidateHome();
  for (const [locale, rows] of Object.entries(feeds) as [
    string,
    FakeHomeRow[],
  ][]) {
    const lead = `/${locale}/tracks/${leadTrackId(rows)}`;
    await expect
      .poll(async () => {
        const response = await fetch(`${baseURL}/${locale}`);
        return response.text();
      })
      .toContain(lead);
  }
}

function carouselSections(page: Page) {
  return page.locator('section[aria-labelledby^="home-"]');
}

// The fake API and the web cache are shared by the whole file, so the specs
// run one after another, each installing its own feed first.
test.describe.configure({ mode: 'serial' });

// The fake API keeps the last feed installed, and every suite shares the
// web's home. Put the default feed back once this file is done.
test.afterAll(async () => {
  await setHomeMock({
    feeds: { en: defaultHomeRows('en'), 'pt-BR': defaultHomeRows('pt-BR') },
  });
  await revalidateHome();
});

test.describe('home feed', () => {
  test('a visitor sees the hero and the carousels of the locale feed', async ({
    page,
  }) => {
    const heroId = uniqueId('en-hero');
    await installFeed({
      en: [
        hero(heroId),
        carousel('trending-today', trendingKey, [
          card('en-a', 'Fixture second song'),
          card('en-b', 'Fixture linked song'),
        ]),
      ],
    });

    await page.goto('/en');

    await expect(
      page.getByRole('heading', { level: 2, name: 'Fixture lead song' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: messages.en.home.hero.sing, exact: true }),
    ).toHaveAttribute('href', `/en/tracks/${heroId}`);
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: messages.en.home.rows.trendingToday,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Fixture second song/ }),
    ).toBeVisible();
  });

  test('loads every Track in a 48-item public carousel page by page', async ({
    page,
  }) => {
    const pageReleases: (() => void)[] = [];
    const pageSizes: number[] = [];
    await page.route(/\/v1\/home\/rows\/[^/]+\/items\?/, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { items: unknown[] };
      pageSizes.push(body.items.length);
      // Prefetch may run ahead; release one real response per paging assertion.
      await new Promise<void>((resolve) => pageReleases.push(resolve));
      await route.fulfill({ response });
    });
    const cards = Array.from({ length: 48 }, (_, index) =>
      card(`public-48-${index}`, `Public 48 song ${index}`),
    );
    await installFeed({
      en: [
        hero(uniqueId('en-hero')),
        carousel('trending-today', trendingKey, cards),
      ],
    });

    await page.goto('/en');
    const row = page.getByRole('region', {
      name: messages.en.home.rows.trendingToday,
    });
    const items = row.locator('[data-home-item-id]:not([aria-hidden="true"])');
    const track = row.locator('ul');
    await expect(items).toHaveCount(12);
    for (const expected of [24, 36, 48]) {
      await track.evaluate((element) => {
        element.scrollLeft = element.scrollWidth;
        element.dispatchEvent(new Event('scroll'));
      });
      await expect.poll(() => pageReleases.length).toBeGreaterThan(0);
      const release = pageReleases.shift();
      if (!release) throw new Error('Expected the next horizontal response');
      release();
      await expect(items).toHaveCount(expected);
    }
    const ids = await items.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-home-item-id')),
    );
    expect(new Set(ids).size).toBe(48);
    expect(pageSizes).toEqual([12, 12, 12]);
    expect(ids).toEqual(cards.map(({ id }) => id));
  });

  test('a card is a real link to its Track, and middle-click opens it in a new tab', async ({
    page,
    context,
  }) => {
    await installFeed({
      en: [
        hero(uniqueId('en-hero')),
        carousel('trending-today', trendingKey, [
          card('en-link', 'Fixture linked song'),
        ]),
      ],
    });

    await page.goto('/en');
    const link = page.getByRole('link', { name: /Fixture linked song/ });
    await expect(link).toHaveAttribute('href', '/en/tracks/en-link');

    const popupPromise = context.waitForEvent('page');
    await link.click({ button: 'middle' });
    const popup = await popupPromise;
    await expect(popup).toHaveURL(/\/en\/tracks\/en-link$/);
  });

  test('scrolling loads the next rows from the API', async ({ page }) => {
    await installFeed({ en: longFeed('scroll') });

    await page.goto('/en');
    await expect(carouselSections(page)).toHaveCount(6);
    await expect(
      page.getByRole('link', { name: /Fixture late song/ }),
    ).toHaveCount(0);

    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );

    await expect(carouselSections(page)).toHaveCount(9);
    await expect(
      page.getByRole('link', { name: /Fixture late song/ }),
    ).toBeVisible();
  });

  test('the home is translated for pt-BR', async ({ page }) => {
    await installFeed({
      'pt-BR': [
        hero('pt-hero'),
        carousel('trending-today', trendingKey, [
          card('pt-a', 'Fixture pt song'),
        ]),
      ],
    });

    await page.goto('/pt-BR');

    await expect(
      page.getByRole('heading', {
        level: 2,
        name: messages['pt-BR'].home.rows.trendingToday,
      }),
    ).toBeVisible();
  });

  test('an unknown layout is skipped and the rest of the page renders', async ({
    page,
  }) => {
    await installFeed({
      en: [
        hero(uniqueId('en-hero')),
        { id: 'future', layout: 'ranked-top-10', title: {}, items: [] },
        carousel('new-tracks', newKey, [
          card('en-after', 'Fixture after unknown'),
        ]),
      ],
    });

    await page.goto('/en');

    await expect(
      page.getByRole('link', { name: /Fixture after unknown/ }),
    ).toBeVisible();
    await expect(
      page.getByText(messages.en.home.feed.loadMoreError),
    ).toHaveCount(0);
  });

  test('a sponsored row shows the discreet notice, linked to the advertising terms', async ({
    page,
  }) => {
    await installFeed({
      en: [
        hero(uniqueId('en-hero')),
        carousel(
          'sponsored-row',
          trendingKey,
          [card('en-sponsored', 'Fixture sponsored song')],
          true,
        ),
      ],
    });

    await page.goto('/en');
    const notice = page.getByRole('link', {
      name: messages.en.home.sponsored.row,
      exact: true,
    });
    await expect(notice).toHaveAttribute(
      'href',
      `/en/terms#${TERMS_ADVERTISING_FRAGMENT}`,
    );

    await notice.click();

    await expect(page).toHaveURL(
      new RegExp(`/en/terms#${TERMS_ADVERTISING_FRAGMENT}$`),
    );
    await expect(page.locator(`#${TERMS_ADVERTISING_FRAGMENT}`)).toBeVisible();
  });

  test('a sponsored hero shows its caption inside the hero', async ({
    page,
  }) => {
    await installFeed({
      en: [
        hero('en-sponsored-hero', true),
        carousel('new-tracks', newKey, [
          card('en-plain', 'Fixture plain song'),
        ]),
      ],
    });

    await page.goto('/en');

    await expect(
      page.getByRole('link', {
        name: messages.en.home.sponsored.hero,
        exact: true,
      }),
    ).toHaveAttribute('href', `/en/terms#${TERMS_ADVERTISING_FRAGMENT}`);
  });

  test('rows without the flag show no sponsored notice', async ({ page }) => {
    await installFeed({
      en: [
        hero(uniqueId('en-hero')),
        carousel('trending-today', trendingKey, [
          card('en-plain-2', 'Fixture plain'),
        ]),
      ],
    });

    await page.goto('/en');
    await expect(
      page.getByRole('link', { name: /Fixture plain/ }),
    ).toBeVisible();

    await expect(
      page.getByRole('link', { name: messages.en.home.sponsored.row }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', {
        name: messages.en.home.sponsored.hero,
        exact: true,
      }),
    ).toHaveCount(0);
  });
});

/** The session cookie the web reads, like the real Better Auth one. */
const SESSION_COOKIE = {
  name: 'vozzify.session_token',
  value: 'signed-in',
};

/**
 * Signs the browser in for the home: the session cookie drives the
 * server-rendered feed. Later pages resolve through the cursor, which names
 * its own feed version. (The browser can't carry a cookie to the API's
 * `127.0.0.1` hostname in this Chromium, and production uses one cookie
 * domain for web and API anyway.)
 */
async function signIn(context: BrowserContext) {
  await context.addCookies([
    { ...SESSION_COOKIE, url: 'http://localhost:3000' },
  ]);
}

const continueKey = 'home.rows.continueSinging';
const singAgainKey = 'home.rows.singAgain';
const dailyTargetKey = 'home.rows.dailyTarget';

const dailyTargetStrip = (
  id: string,
  secondsLeft = 720,
  completedToday = false,
): FakeHomeRow => ({
  id,
  layout: 'daily-target',
  title: { key: dailyTargetKey, params: {} },
  secondsLeft,
  targetSeconds: 900,
  streakDays: 5,
  completedToday,
});

/**
 * Installs the public feed and the signed-in one, waiting until the web
 * serves each. The personal poll sends the session cookie, like the signed-in
 * page does when it forwards it to the API.
 */
async function installPersonalFeed(
  prefix: string,
  personal: FakeHomeRow[],
  waitFor?: string,
): Promise<void> {
  await installFeed({ en: [hero(`${prefix}-public-hero`)] });
  await setHomeMock({ personal: { en: personal } });
  await revalidateHome();
  const lead = waitFor ?? `/en/tracks/${leadTrackId(personal)}`;
  await expect
    .poll(
      async () => {
        const response = await fetch(`${baseURL}/en`, {
          headers: { cookie: `${SESSION_COOKIE.name}=${SESSION_COOKIE.value}` },
        });
        // React escapes apostrophes in server HTML; the message files (and
        // getByText below) use the plain character.
        return (await response.text()).replaceAll('&#x27;', "'");
      },
      { timeout: 15000 },
    )
    .toContain(lead);
}

test.describe('signed-in home feed', () => {
  test('a signed-in visitor gets their personal feed, not the public one', async ({
    page,
    context,
  }) => {
    await installPersonalFeed('personal', [
      carousel('continue-singing', continueKey, [
        card('en-resume-1', 'Fixture resume song'),
        card('en-resume-2', 'Fixture resume two'),
        card('en-resume-3', 'Fixture resume three'),
        card('en-resume-4', 'Fixture resume four'),
        card('en-resume-5', 'Fixture resume five'),
        card('en-resume-6', 'Fixture resume six'),
      ]),
      carousel('sing-again', singAgainKey, [
        card('en-encore-1', 'Fixture encore song'),
        card('en-encore-2', 'Fixture encore two'),
        card('en-encore-3', 'Fixture encore three'),
        card('en-encore-4', 'Fixture encore four'),
        card('en-encore-5', 'Fixture encore five'),
        card('en-encore-6', 'Fixture encore six'),
      ]),
      dailyTargetStrip('daily-target'),
    ]);
    await signIn(context);

    await page.goto('/en');

    await expect(
      page.getByRole('heading', {
        level: 2,
        name: messages.en.home.rows.continueSinging,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: messages.en.home.rows.singAgain,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        level: 2,
        name: messages.en.home.rows.dailyTarget,
      }),
    ).toBeVisible();
    await expect(
      page.getByText('12 minutes left of your 15-minute goal'),
    ).toBeVisible();
    await expect(page.getByText('5 day streak')).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Fixture resume song/ }),
    ).toBeVisible();
    // The public hero never flashes: the first paint is already personal.
    await expect(page.getByText('Fixture lead song')).toHaveCount(0);
  });

  test('scrolling loads the next personal rows from the API', async ({
    page,
    context,
  }) => {
    const rows: FakeHomeRow[] = [
      carousel('continue-singing', continueKey, [
        card('en-scroll-resume', 'Fixture scroll resume'),
        card('en-scroll-r2', 'Fixture scroll resume two'),
        card('en-scroll-r3', 'Fixture scroll resume three'),
        card('en-scroll-r4', 'Fixture scroll resume four'),
        card('en-scroll-r5', 'Fixture scroll resume five'),
        card('en-scroll-r6', 'Fixture scroll resume six'),
      ]),
      dailyTargetStrip('daily-target'),
    ];
    for (let index = 1; index <= 7; index += 1) {
      rows.push(
        carousel(`row-${index}`, index % 2 ? trendingKey : newKey, [
          card(`en-scroll-${index}`, `Fixture scroll song ${index}`),
        ]),
      );
    }
    rows.push(
      carousel('row-8', trendingKey, [
        card('en-scroll-late', 'Fixture scroll late song'),
      ]),
    );
    await installPersonalFeed('scroll-personal', rows);
    await signIn(context);

    await page.goto('/en');
    await expect(
      page.getByRole('link', { name: /Fixture scroll late song/ }),
    ).toHaveCount(0);

    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );

    await expect(
      page.getByRole('link', { name: /Fixture scroll late song/ }),
    ).toBeVisible();
  });

  test('a completed day reads as complete on the strip', async ({
    page,
    context,
  }) => {
    await installPersonalFeed(
      'done-personal',
      [dailyTargetStrip('daily-target', 0, true)],
      messages.en.home.dailyTarget.completeToday,
    );
    await signIn(context);

    await page.goto('/en');

    await expect(
      page.getByText(messages.en.home.dailyTarget.completeToday),
    ).toBeVisible();
  });
});
