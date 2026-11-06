import { expect, test } from '@playwright/test';

import { mockAuthApi } from './auth-api-mock';
import { defaultArtist, setArtistMock } from './fake-artist-api-server';
import { messages as catalogs } from './messages';

const cases = [
  { locale: 'en', messages: catalogs.en },
  { locale: 'pt-BR', messages: catalogs['pt-BR'] },
] as const;

const mbidOf = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

for (const { locale, messages } of cases) {
  test.describe(`artist header (${locale})`, () => {
    test('renders the header with name, count and genres', async ({ page }) => {
      await mockAuthApi(page);
      const id = `artist-header-${locale}`;
      await setArtistMock({
        artists: [
          {
            id,
            mbid: mbidOf(2001),
            name: 'Queen',
            genres: ['rock', 'pop'],
            trackCount: 2,
          },
        ],
      });

      await page.goto(`/${locale}/artists/${id}`);

      await expect(
        page.getByRole('heading', { level: 1, name: 'Queen' }),
      ).toBeVisible();
      const countText = locale === 'en' ? '2 tracks' : '2 faixas';
      await expect(page.getByText(countText).first()).toBeVisible();
      const genres = page.getByRole('list', {
        name: messages.artists.header.genresLabel,
      });
      await expect(genres).toBeVisible();
      await expect(genres.getByRole('listitem')).toHaveCount(2);
    });

    test('serves translated metadata with canonical and hreflang', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `artist-meta-${locale}`;
      await setArtistMock({
        artists: [
          {
            id,
            mbid: mbidOf(2002),
            name: 'Queen',
            genres: ['rock'],
            trackCount: 3,
          },
        ],
      });

      await page.goto(`/${locale}/artists/${id}`);

      await expect(page).toHaveTitle(/Queen/);
      const canonical = page.locator('link[rel="canonical"]');
      await expect(canonical).toHaveAttribute(
        'href',
        new RegExp(`/${locale}/artists/${id}$`),
      );
      for (const alternate of ['en', 'pt-BR', 'x-default']) {
        await expect(
          page.locator(`link[rel="alternate"][hreflang="${alternate}"]`),
        ).toHaveCount(1);
      }
    });

    test('shows same-dimension skeletons while loading', async ({ page }) => {
      await mockAuthApi(page);
      const id = `artist-slow-${locale}`;
      await setArtistMock({
        artists: [
          {
            id,
            mbid: mbidOf(2003),
            name: 'Queen',
            genres: ['rock', 'pop'],
            trackCount: 2,
            delayMs: 800,
          },
        ],
      });

      // Assert while loading: `goto` only resolves once the header lands.
      const navigation = page.goto(`/${locale}/artists/${id}`);
      await expect(
        page.getByRole('status', { name: messages.artists.header.loading }),
      ).toBeVisible();
      await navigation;
      await expect(
        page.getByRole('heading', { level: 1, name: 'Queen' }),
      ).toBeVisible();
    });

    test('legacy ID redirects with 308 keeping the query', async ({
      page,
      request,
      baseURL,
    }) => {
      await mockAuthApi(page);
      const newId = `artist-308-new-${locale}`;
      const legacyId = `legacy-308-${locale}`;
      await setArtistMock({
        artists: [
          {
            id: newId,
            mbid: mbidOf(2004),
            name: 'Queen',
            genres: ['rock'],
            trackCount: 1,
          },
        ],
        legacyMap: { [legacyId]: newId },
      });

      // A real permanent redirect, not a client-side hop.
      const raw = await request.get(`/${locale}/artists/${legacyId}?x=1`, {
        maxRedirects: 0,
      });
      expect(raw.status()).toBe(308);
      const location = raw.headers().location;
      expect(location).toBeTruthy();
      const url = new URL(location ?? '', baseURL);
      expect(url.pathname).toBe(`/${locale}/artists/${newId}`);
      expect(url.searchParams.get('x')).toBe('1');

      await page.goto(`/${locale}/artists/${legacyId}?x=1`);

      await expect(page).toHaveURL(`/${locale}/artists/${newId}?x=1`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Queen' }),
      ).toBeVisible();
    });

    test('unknown ID is a real 404', async ({ page }) => {
      await mockAuthApi(page);

      const response = await page.goto(
        `/${locale}/artists/does-not-exist-${locale}`,
      );

      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole('heading', { name: `404 ${messages.notFound.title}` }),
      ).toBeVisible();
    });

    test('stays usable on small screens', async ({ page }) => {
      await mockAuthApi(page);
      await page.setViewportSize({ width: 360, height: 800 });

      await page.goto(`/${locale}/artists/${defaultArtist.id}`);

      await expect(
        page.getByRole('heading', { level: 1, name: defaultArtist.name }),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
