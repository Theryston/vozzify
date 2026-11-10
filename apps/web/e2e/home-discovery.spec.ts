import { expect, test } from '@playwright/test';

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

// Each fixture gets its own lead Track, so `installFeed` can tell the feed it
// installed from a stale one a previous test left in the web cache.
let fixtureSeq = 0;
const uniqueId = (prefix: string): string => `${prefix}-${++fixtureSeq}`;

const genresKey = 'home.rows.genres';
const featuredArtistsKey = 'home.rows.featuredArtists';
const featuredAlbumsKey = 'home.rows.featuredAlbums';

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

test.describe('home discovery rows', () => {
  test('a long carousel loads later cards once and retries a failed page', async ({
    page,
  }) => {
    const items = Array.from({ length: 24 }, (_, index) =>
      toItem(card(`long-row-${index}`, `Long row song ${index}`)),
    );
    const rows = [
      hero(uniqueId('en-hero')),
      {
        id: 'long-carousel',
        layout: 'standard',
        title: { key: 'home.rows.trendingToday', params: {} },
        items,
      },
    ];
    await installFeed({ en: rows });
    await setHomeMock({ itemPageFailures: 1 });
    const requests: number[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/v1/home/rows/long-carousel/items')) {
        requests.push(response.status());
      }
    });
    await page.goto('/en');
    const row = page.locator('[data-home-row-id="long-carousel"]');
    const track = row.locator('ul');
    await expect(
      row.locator('[data-home-item-id="long-row-11"]'),
    ).toBeAttached();
    await expect(row.locator('[data-home-item-id="long-row-12"]')).toHaveCount(
      0,
    );

    await track.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.dispatchEvent(new Event('scroll'));
      element.dispatchEvent(new Event('scroll'));
      element.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    expect(requests).toEqual([503]);
    await expect(row.getByRole('alert')).toBeVisible();
    await page.waitForTimeout(750);
    expect(requests).toEqual([503]);

    await row
      .getByRole('button', { name: messages.en.home.carousel.retryItems })
      .click();
    await expect(
      row.locator(
        '[data-home-item-id="long-row-12"]:not([aria-hidden="true"])',
      ),
    ).toBeAttached();
    await expect(
      row.locator(
        '[data-home-item-id="long-row-23"]:not([aria-hidden="true"])',
      ),
    ).toBeAttached();
    expect(requests).toEqual([503, 200]);
    await expect(
      row.getByRole('button', { name: messages.en.home.carousel.scrollRight }),
    ).toBeEnabled();
    await expect(
      row.locator(
        '[data-home-item-id="long-row-12"]:not([aria-hidden="true"])',
      ),
    ).toHaveAttribute('data-home-item-position', '12');
  });

  test('an expired horizontal cursor restarts both Home axes from page one', async ({
    page,
  }) => {
    const buildFeed = (prefix: string) => [
      hero(`${prefix}-hero`),
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `${prefix}-before-${index}`,
        layout: 'standard' as const,
        title: { key: 'home.rows.trendingToday', params: {} },
        items: [toItem(card(`${prefix}-before-track-${index}`, 'Earlier row'))],
      })),
      {
        id: 'rolling-carousel',
        layout: 'standard',
        title: { key: 'home.rows.trendingToday', params: {} },
        items: Array.from({ length: 48 }, (_, index) =>
          toItem(card(`${prefix}-${index}`, `${prefix} song ${index}`)),
        ),
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `${prefix}-after-${index}`,
        layout: 'standard' as const,
        title: { key: 'home.rows.trendingToday', params: {} },
        items: [toItem(card(`${prefix}-after-track-${index}`, 'Later row'))],
      })),
    ];
    await installFeed({ en: buildFeed('old') });
    const itemResponses: number[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/v1/home/rows/rolling-carousel/items')) {
        itemResponses.push(response.status());
      }
    });
    const verticalPage = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/v1/home' && url.searchParams.has('cursor');
    });
    await page.goto('/en');
    await page
      .locator('[data-home-row-id="old-before-3"]')
      .scrollIntoViewIfNeeded();
    await verticalPage;
    await expect(page.locator('[data-home-row-id="old-after-0"]')).toHaveCount(
      1,
    );
    const row = page.locator('[data-home-row-id="rolling-carousel"]');
    await row.scrollIntoViewIfNeeded();
    await expect(row.locator('[data-home-item-id="old-11"]')).toBeAttached();
    await row.locator('ul').evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      element.dispatchEvent(new Event('scroll'));
    });
    await expect(row.locator('[data-home-item-id="old-12"]')).toBeAttached();
    await expect(row.locator('[data-home-item-id="old-23"]')).toBeAttached();

    await setHomeMock({ feeds: { en: buildFeed('new') } });
    await revalidateHome();
    const scrollRight = row.getByRole('button', {
      name: messages.en.home.carousel.scrollRight,
    });
    await scrollRight.click();
    await scrollRight.click();
    await scrollRight.click();
    await expect.poll(() => itemResponses).toContain(404);
    const refreshedRow = page.locator('[data-home-row-id="rolling-carousel"]');
    await expect(
      refreshedRow.locator('[data-home-item-id="new-11"]'),
    ).toBeAttached();
    await expect(
      refreshedRow.locator('[data-home-item-id="old-12"]'),
    ).toHaveCount(0);
    await expect(
      refreshedRow.locator('[data-home-item-id="old-0"]'),
    ).toHaveCount(0);
    await expect(page.locator('[data-home-row-id="old-after-0"]')).toHaveCount(
      0,
    );
    await expect(page.locator('[data-home-row-id="new-after-0"]')).toHaveCount(
      1,
    );
    await expect
      .poll(() =>
        refreshedRow.locator('ul').evaluate((element) => element.scrollLeft),
      )
      .toBe(0);
    const firstNewCard = refreshedRow.locator('[data-home-item-id="new-0"]');
    await expect
      .poll(() =>
        firstNewCard.evaluate((element) => {
          const card = element.getBoundingClientRect();
          const track = element.closest('ul')?.getBoundingClientRect();
          return Boolean(
            track && card.left >= track.left && card.right <= track.right,
          );
        }),
      )
      .toBe(true);
  });

  test('a visitor sees the genre tiles, each a real link to its search', async ({
    page,
  }) => {
    await installFeed({
      en: [
        hero(uniqueId('en-hero')),
        {
          id: 'genres',
          layout: 'genres',
          title: { key: genresKey, params: {} },
          items: [{ name: 'Rock' }, { name: 'R&B' }],
        },
      ],
    });

    await page.goto('/en');

    await expect(
      page.getByRole('heading', {
        level: 2,
        name: messages.en.home.rows.genres,
      }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Rock' })).toHaveAttribute(
      'href',
      '/en/search?q=Rock',
    );
    await expect(page.getByRole('link', { name: 'R&B' })).toHaveAttribute(
      'href',
      '/en/search?q=R%26B',
    );
  });

  test('a visitor sees the featured artists, each a real link to its page', async ({
    page,
  }) => {
    await installFeed({
      en: [
        hero(uniqueId('en-hero')),
        {
          id: 'featured-artists',
          layout: 'artists',
          title: { key: featuredArtistsKey, params: {} },
          items: [
            { id: 'en-artist-1', name: 'Fixture artist one' },
            { id: 'en-artist-2', name: 'Fixture artist two' },
          ],
        },
      ],
    });

    await page.goto('/en');

    await expect(
      page.getByRole('heading', {
        level: 2,
        name: messages.en.home.rows.featuredArtists,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Fixture artist one' }),
    ).toHaveAttribute('href', '/en/artists/en-artist-1');
    await expect(
      page.getByRole('link', { name: 'Fixture artist two' }),
    ).toHaveAttribute('href', '/en/artists/en-artist-2');
  });

  test('a visitor sees the featured albums, each a real link to its page', async ({
    page,
  }) => {
    await installFeed({
      en: [
        hero(uniqueId('en-hero')),
        {
          id: 'featured-albums',
          layout: 'albums',
          title: { key: featuredAlbumsKey, params: {} },
          items: [
            {
              id: 'en-album-1',
              title: 'Fixture album one',
              coverArtUrl: null,
              year: 1975,
            },
          ],
        },
      ],
    });

    await page.goto('/en');

    await expect(
      page.getByRole('heading', {
        level: 2,
        name: messages.en.home.rows.featuredAlbums,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Fixture album one/ }),
    ).toHaveAttribute('href', '/en/albums/en-album-1');
  });

  test('a sponsored artists row shows the discreet notice', async ({
    page,
  }) => {
    await installFeed({
      en: [
        hero(uniqueId('en-hero')),
        {
          id: 'featured-artists',
          layout: 'artists',
          sponsored: true,
          title: { key: featuredArtistsKey, params: {} },
          items: [{ id: 'en-artist-1', name: 'Fixture artist one' }],
        },
      ],
    });

    await page.goto('/en');
    await expect(
      page.getByRole('link', {
        name: messages.en.home.sponsored.row,
        exact: true,
      }),
    ).toHaveAttribute('href', `/en/terms#${TERMS_ADVERTISING_FRAGMENT}`);
  });
});
