import { expect, test } from '@playwright/test';

import { mockAuthApi } from './auth-api-mock';
import {
  defaultAlbum,
  type FakeAlbum,
  setAlbumMock,
} from './fake-album-api-server';
import { messages as catalogs } from './messages';

// The fixtures mock no tracks, so the info line always ends with "0 tracks".
const cases = [
  {
    locale: 'en',
    messages: catalogs.en,
    moreName: 'and 2 more',
    zeroTracks: '0 tracks',
  },
  {
    locale: 'pt-BR',
    messages: catalogs['pt-BR'],
    moreName: 'e mais 2',
    zeroTracks: '0 faixas',
  },
] as const;

const mbidOf = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A header-ready album; each test overrides only what it checks. */
const albumFixture = (id: string, overrides: Partial<FakeAlbum> = {}) => ({
  id,
  mbid: mbidOf(3000),
  title: 'A Night at the Opera',
  primaryType: 'Album',
  secondaryTypes: [],
  year: 1975,
  genres: ['rock', 'pop'],
  coverArtUrl: null,
  artists: [{ id: 'clx456def', name: 'Queen' }],
  ...overrides,
});

/** The Cover Art Archive front of a release group, as the importer writes it. */
const coverOf = (n: number): string =>
  `https://coverartarchive.org/release-group/${mbidOf(n)}/front-500`;

/** The fake Cover Art Archive answers 404 for release groups ending in `dead`. */
const BROKEN_COVER =
  'https://coverartarchive.org/release-group/00000000-0000-4000-8000-00000000dead/front-500';

const fiveArtists = [
  { id: 'album-a1', name: 'Queen' },
  { id: 'album-a2', name: 'David Bowie' },
  { id: 'album-a3', name: 'Freddie Mercury' },
  { id: 'album-a4', name: 'Brian May' },
  { id: 'album-a5', name: 'Roger Taylor' },
];

for (const { locale, messages, moreName, zeroTracks } of cases) {
  const header = (page: import('@playwright/test').Page) =>
    page.locator('section[aria-labelledby="album-title"]');

  test.describe(`album header (${locale})`, () => {
    test('renders the title, the linked artists and the info line', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `album-header-${locale}`;
      await setAlbumMock({ albums: [albumFixture(id)] });

      await page.goto(`/${locale}/albums/${id}`);

      await expect(
        page.getByRole('heading', { level: 1, name: 'A Night at the Opera' }),
      ).toBeVisible();
      const artists = page.getByRole('list', {
        name: messages.albums.header.artistsLabel,
      });
      const queen = artists.getByRole('link', { name: 'Queen' });
      await expect(queen).toHaveAttribute(
        'href',
        `/${locale}/artists/clx456def`,
      );
      const info = [
        messages.albums.types.primary.album,
        '1975',
        zeroTracks,
      ].join(messages.albums.header.separator);
      await expect(header(page).getByText(info, { exact: true })).toBeVisible();
    });

    test('serves translated metadata with canonical and hreflang', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `album-meta-${locale}`;
      await setAlbumMock({ albums: [albumFixture(id)] });

      await page.goto(`/${locale}/albums/${id}`);

      await expect(page).toHaveTitle(/A Night at the Opera/);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        new RegExp(`/${locale}/albums/${id}$`),
      );
      for (const alternate of ['en', 'pt-BR', 'x-default']) {
        await expect(
          page.locator(`link[rel="alternate"][hreflang="${alternate}"]`),
        ).toHaveCount(1);
      }
    });

    test('shows the geometric placeholder instead of a missing cover', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `album-cover-${locale}`;
      await setAlbumMock({ albums: [albumFixture(id, { coverArtUrl: null })] });

      await page.goto(`/${locale}/albums/${id}`);

      await expect(
        page.getByRole('heading', { level: 1, name: 'A Night at the Opera' }),
      ).toBeVisible();
      await expect(header(page).locator('img')).toHaveCount(0);
    });

    test('renders the cover art when the album has one', async ({ page }) => {
      await mockAuthApi(page);
      const id = `album-art-${locale}`;
      await setAlbumMock({
        albums: [albumFixture(id, { coverArtUrl: coverOf(3001) })],
      });
      // Through the real image optimizer: its allowlist (next.config.ts) and
      // its upstream lookup, answered by the fake Cover Art Archive.
      const optimized = page.waitForResponse('**/_next/image**');
      await page.goto(`/${locale}/albums/${id}`);
      expect((await optimized).status()).toBe(200);

      // An image that fails to load is removed by the fallback, so the
      // element staying in place with `complete` set means it loaded.
      const cover = header(page).locator('img');
      await expect(cover).toHaveCount(1);
      await expect
        .poll(() => cover.evaluate((img: HTMLImageElement) => img.complete))
        .toBe(true);
    });

    test('falls back to the placeholder when the cover fails to load', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `album-art-broken-${locale}`;
      await setAlbumMock({
        albums: [albumFixture(id, { coverArtUrl: BROKEN_COVER })],
      });
      const optimized = page.waitForResponse('**/_next/image**');

      await page.goto(`/${locale}/albums/${id}`);
      expect((await optimized).status()).not.toBe(200);

      await expect(header(page).locator('img')).toHaveCount(0);
      await expect(
        header(page)
          .locator('[aria-hidden="true"][style*="background-color"]')
          .first(),
      ).toBeAttached();
    });

    test('lists the first three artists and expands the rest from one button', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `album-artists-${locale}`;
      await setAlbumMock({
        albums: [albumFixture(id, { artists: fiveArtists })],
      });

      await page.goto(`/${locale}/albums/${id}`);

      const artists = page.getByRole('list', {
        name: messages.albums.header.artistsLabel,
      });
      await expect(artists.getByRole('link')).toHaveCount(3);
      await expect(
        artists.getByRole('link', { name: 'Freddie Mercury' }),
      ).toBeVisible();
      await expect(
        artists.getByRole('link', { name: 'Roger Taylor' }),
      ).toHaveCount(0);

      const more = page.getByRole('button', { name: moreName });
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await more.click();

      const less = page.getByRole('button', {
        name: messages.albums.header.artists.less,
      });
      await expect(less).toHaveAttribute('aria-expanded', 'true');
      await expect(
        artists.getByRole('link', { name: 'Roger Taylor' }),
      ).toBeVisible();
    });

    test('leaves out the unknown parts of the info line', async ({ page }) => {
      await mockAuthApi(page);
      const id = `album-info-${locale}`;
      await setAlbumMock({
        albums: [albumFixture(id, { primaryType: null, year: 1980 })],
      });

      await page.goto(`/${locale}/albums/${id}`);

      // With no primary type the year leads the line, and the track count
      // still follows it: the one separator left sits between those two.
      await expect(
        header(page).getByText(
          ['1980', zeroTracks].join(messages.albums.header.separator),
          { exact: true },
        ),
      ).toBeVisible();
      await expect(
        header(page).getByText(messages.albums.header.separator),
      ).toHaveCount(1);
    });

    test('shows the secondary types next to the primary type', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `album-secondary-${locale}`;
      await setAlbumMock({
        albums: [albumFixture(id, { secondaryTypes: ['Live'] })],
      });

      await page.goto(`/${locale}/albums/${id}`);

      const info = [
        messages.albums.types.primary.album,
        messages.albums.types.secondary.live,
        '1975',
        zeroTracks,
      ].join(messages.albums.header.separator);
      await expect(header(page).getByText(info, { exact: true })).toBeVisible();
    });

    test('shows genre chips only when the album has genres', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const withGenres = `album-genres-${locale}`;
      const withoutGenres = `album-nogenres-${locale}`;
      await setAlbumMock({
        albums: [
          albumFixture(withGenres, { genres: ['rock', 'pop'] }),
          albumFixture(withoutGenres, { genres: [] }),
        ],
      });

      await page.goto(`/${locale}/albums/${withGenres}`);
      const chips = page.getByRole('list', {
        name: messages.albums.header.genresLabel,
      });
      await expect(chips.getByRole('listitem')).toHaveCount(2);

      await page.goto(`/${locale}/albums/${withoutGenres}`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'A Night at the Opera' }),
      ).toBeVisible();
      await expect(
        page.getByRole('list', { name: messages.albums.header.genresLabel }),
      ).toHaveCount(0);
    });

    test('shows same-dimension skeletons while loading', async ({ page }) => {
      await mockAuthApi(page);
      const id = `album-slow-${locale}`;
      await setAlbumMock({
        albums: [albumFixture(id, { delayMs: 800 })],
      });

      // Assert while loading: `goto` only resolves once the header lands.
      const navigation = page.goto(`/${locale}/albums/${id}`);
      await expect(
        page.getByRole('status', { name: messages.albums.header.loading }),
      ).toBeVisible();
      await navigation;
      await expect(
        page.getByRole('heading', { level: 1, name: 'A Night at the Opera' }),
      ).toBeVisible();
    });

    test('legacy ID redirects with 308 keeping the query', async ({
      page,
      request,
      baseURL,
    }) => {
      await mockAuthApi(page);
      const newId = `album-308-new-${locale}`;
      const legacyId = `legacy-album-308-${locale}`;
      await setAlbumMock({
        albums: [albumFixture(newId)],
        legacyMap: { [legacyId]: newId },
      });

      // A real permanent redirect, not a client-side hop.
      const raw = await request.get(`/${locale}/albums/${legacyId}?x=1`, {
        maxRedirects: 0,
      });
      expect(raw.status()).toBe(308);
      const location = raw.headers().location;
      expect(location).toBeTruthy();
      const url = new URL(location ?? '', baseURL);
      expect(url.pathname).toBe(`/${locale}/albums/${newId}`);
      expect(url.searchParams.get('x')).toBe('1');

      await page.goto(`/${locale}/albums/${legacyId}?x=1`);

      await expect(page).toHaveURL(`/${locale}/albums/${newId}?x=1`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'A Night at the Opera' }),
      ).toBeVisible();
    });

    test('unknown ID is a real 404', async ({ page }) => {
      await mockAuthApi(page);

      const response = await page.goto(
        `/${locale}/albums/does-not-exist-${locale}`,
      );

      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole('heading', { name: `404 ${messages.notFound.title}` }),
      ).toBeVisible();
    });

    test('stays usable on small screens', async ({ page }) => {
      await mockAuthApi(page);
      await page.setViewportSize({ width: 360, height: 800 });

      await page.goto(`/${locale}/albums/${defaultAlbum.id}`);

      await expect(
        page.getByRole('heading', { level: 1, name: defaultAlbum.title }),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
