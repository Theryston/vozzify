import { expect, test } from '@playwright/test';

import { mockAuthApi } from './auth-api-mock';
import { setArtistMock } from './fake-artist-api-server';
import { defaultArtistTracks, type FakeTrack } from './fake-artist-tracks';
import { messages as catalogs } from './messages';

const cases = [
  { locale: 'en', messages: catalogs.en },
  { locale: 'pt-BR', messages: catalogs['pt-BR'] },
] as const;

const mbidOf = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const makeTrack = (
  artistId: string,
  artistName: string,
  index: number,
  overrides: Partial<FakeTrack> = {},
): FakeTrack => ({
  id: `track-card-${index}`,
  title: `Track ${index}`,
  coverUrl: null,
  lengthMs: 180_000 + index * 1_000,
  disambiguation: '',
  video: false,
  isrcs: index === 0 ? ['GBUM71029604'] : [],
  artists: [{ id: artistId, name: artistName }],
  genres: index === 0 ? ['rock'] : [],
  ...overrides,
});

for (const { locale, messages } of cases) {
  test.describe(`artist track cards (${locale})`, () => {
    test('renders cards with title, artists subtitle and track links', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `artist-cards-${locale}`;
      await setArtistMock({
        artists: [
          {
            id,
            mbid: mbidOf(3001),
            name: 'Queen',
            genres: ['rock'],
            trackCount: 2,
          },
        ],
        tracksByArtist: {
          [id]: [
            makeTrack(id, 'Queen', 1, {
              id: `track-card-1-${locale}`,
              title: 'Bohemian Rhapsody',
              artists: [
                { id, name: 'Queen' },
                { id: 'artist-collab', name: 'David Bowie' },
              ],
              releases: [
                {
                  mbid: mbidOf(2101),
                  title: 'A Night at the Opera',
                  year: 1975,
                  coverArtUrl:
                    'https://coverartarchive.org/release/2101/front-500',
                },
              ],
            }),
            makeTrack(id, 'Queen', 2, {
              id: `track-card-2-${locale}`,
              title: 'Unknown Take',
              releases: [],
            }),
          ],
        },
      });

      await page.goto(`/${locale}/artists/${id}`);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: messages.artists.tracks.title,
        }),
      ).toBeVisible();

      const first = page.getByRole('link', { name: /Bohemian Rhapsody/ });
      await expect(first).toBeVisible();
      await expect(first).toContainText('Queen, David Bowie');
      await expect(first).toHaveAttribute(
        'href',
        `/${locale}/tracks/track-card-1-${locale}`,
      );

      const second = page.getByRole('link', { name: /Unknown Take/ });
      await expect(second).toBeVisible();
      await expect(second).toContainText('Queen');
      await expect(second).toHaveAttribute(
        'href',
        `/${locale}/tracks/track-card-2-${locale}`,
      );

      // Keyboard-focusable with a visible focus (no mouse needed).
      await first.focus();
      await expect(first).toBeFocused();
    });

    test('loads the next page from the button without a full-page reload', async ({
      page,
    }) => {
      await mockAuthApi(page);
      // The infinite-scroll sentinel would race the explicit button, so
      // neutralize it: this test covers the button path only.
      await page.addInitScript(() => {
        const RealObserver = window.IntersectionObserver;
        window.IntersectionObserver = class extends RealObserver {
          override observe(): void {}
        };
      });
      const id = `artist-pages-${locale}`;
      const tracks: FakeTrack[] = [];
      for (let index = 0; index < 22; index += 1) {
        const padded = String(index).padStart(2, '0');
        tracks.push(
          makeTrack(id, 'Queen', index, {
            id: `track-pag-${locale}-${padded}`,
            title: `Paged Track ${padded}`,
          }),
        );
      }
      await setArtistMock({
        artists: [
          {
            id,
            mbid: mbidOf(3002),
            name: 'Queen',
            genres: [],
            trackCount: 22,
          },
        ],
        tracksByArtist: { [id]: tracks },
      });

      await page.goto(`/${locale}/artists/${id}`);

      await expect(page.getByText('Paged Track 00')).toBeVisible();
      const loadMore = page.getByRole('button', {
        name: messages.artists.tracks.loadMore,
      });
      await expect(loadMore).toBeVisible();
      const urlBefore = page.url();

      await loadMore.click();
      await expect(page.getByText('Paged Track 21')).toBeVisible();
      expect(page.url()).toBe(urlBefore);
      await expect(page.getByText('Paged Track 00')).toBeVisible();
    });

    test('loads the next page on scroll without a full-page reload', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `artist-scroll-${locale}`;
      const tracks: FakeTrack[] = [];
      for (let index = 0; index < 22; index += 1) {
        const padded = String(index).padStart(2, '0');
        tracks.push(
          makeTrack(id, 'Queen', index, {
            id: `track-scroll-${locale}-${padded}`,
            title: `Scrolled Track ${padded}`,
          }),
        );
      }
      await setArtistMock({
        artists: [
          {
            id,
            mbid: mbidOf(3005),
            name: 'Queen',
            genres: [],
            trackCount: 22,
          },
        ],
        tracksByArtist: { [id]: tracks },
      });

      await page.goto(`/${locale}/artists/${id}`);

      await expect(page.getByText('Scrolled Track 00')).toBeVisible();
      const urlBefore = page.url();

      await page.getByText('Scrolled Track 19').scrollIntoViewIfNeeded();
      await expect(page.getByText('Scrolled Track 21')).toBeVisible();
      expect(page.url()).toBe(urlBefore);
      await expect(page.getByText('Scrolled Track 00')).toBeVisible();
    });

    test('stays readable on small screens', async ({ page }) => {
      await mockAuthApi(page);
      await page.setViewportSize({ width: 360, height: 800 });

      await page.goto(`/${locale}/artists/clx456def`);

      await expect(
        page.getByRole('link', { name: /Bohemian Rhapsody/ }),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });

    test('shows an empty state for an artist with no tracks', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `artist-empty-${locale}`;
      await setArtistMock({
        artists: [
          {
            id,
            mbid: mbidOf(3003),
            name: 'Queen',
            genres: [],
            trackCount: 0,
          },
        ],
        tracksByArtist: { [id]: [] },
      });

      await page.goto(`/${locale}/artists/${id}`);

      await expect(
        page.getByRole('heading', {
          level: 2,
          name: messages.artists.tracks.title,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(messages.artists.tracks.empty.title),
      ).toBeVisible();
    });

    test('keeps the header with a retryable error when tracks fail', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `artist-broken-${locale}`;
      await setArtistMock({
        artists: [
          {
            id,
            mbid: mbidOf(3004),
            name: 'Queen',
            genres: [],
            trackCount: 1,
          },
        ],
        tracksErrorByArtist: {
          [id]: { status: 500, code: 'INTERNAL_ERROR' },
        },
      });

      await page.goto(`/${locale}/artists/${id}`);

      // The header still paints; only the grid shows the error UI. The
      // query client retries 500s, so the error surfaces after ~7s.
      await expect(
        page.getByRole('heading', { level: 1, name: 'Queen' }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', {
          level: 2,
          name: messages.artists.tracks.title,
        }),
      ).toBeVisible();
      await expect(
        page.getByText(messages.artists.tracks.error.title),
      ).toBeVisible({ timeout: 20_000 });
      await page
        .getByRole('button', { name: messages.artists.tracks.error.retry })
        .click();
      await expect(
        page.getByText(messages.artists.tracks.error.title),
      ).toBeVisible({ timeout: 20_000 });
    });

    test('renders its cards without missing-message errors', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `artist-messages-${locale}`;
      await setArtistMock({
        artists: [
          {
            id,
            mbid: mbidOf(3006),
            name: 'Queen',
            genres: [],
            trackCount: 1,
          },
        ],
        tracksByArtist: {
          [id]: [
            makeTrack(id, 'Queen', 1, {
              id: `track-messages-${locale}`,
              title: 'Messages Track',
            }),
          ],
        },
      });
      // Each card reads the `tracks` namespace in the browser. When the
      // page's client provider doesn't scope it, next-intl logs
      // MISSING_MESSAGE and the UI falls back to raw keys without visible
      // breakage, so only the console can show it.
      const missingMessages: string[] = [];
      page.on('console', (message) => {
        if (
          message.type() === 'error' &&
          message.text().includes('MISSING_MESSAGE')
        ) {
          missingMessages.push(message.text());
        }
      });

      await page.goto(`/${locale}/artists/${id}`);

      await expect(
        page.getByRole('link', { name: /Messages Track/ }),
      ).toBeVisible();
      // The server-rendered cards are visible before hydration, which is
      // when the client-side translations run and can log the error.
      await page.waitForLoadState('networkidle');
      expect(missingMessages).toEqual([]);
    });
  });
}

test.describe('artist track cards defaults', () => {
  test('default artist lists its sample tracks with links', async ({
    page,
  }) => {
    await mockAuthApi(page);
    await page.goto('/en/artists/clx456def');

    for (const track of defaultArtistTracks) {
      await expect(
        page.getByRole('link', { name: new RegExp(track.title) }),
      ).toHaveAttribute('href', `/en/tracks/${track.id}`);
    }
  });
});
