import { expect, type Page, test } from '@playwright/test';

import { mockAuthApi } from './auth-api-mock';
import { type FakeAlbum, setAlbumMock } from './fake-album-api-server';
import type { FakeAlbumDisc, FakeAlbumTrack } from './fake-album-tracks';
import { messages as catalogs } from './messages';

const cases = [
  {
    locale: 'en',
    messages: catalogs.en,
    tracksCount: (count: number) => `${count} tracks`,
  },
  {
    locale: 'pt-BR',
    messages: catalogs['pt-BR'],
    tracksCount: (count: number) => `${count} faixas`,
  },
] as const;

const mbidOf = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const ARTIST = { id: 'clx456def', name: 'Queen' };

/** A header-ready album; each test overrides only what it checks. */
const albumFixture = (id: string, overrides: Partial<FakeAlbum> = {}) => ({
  id,
  mbid: mbidOf(4000),
  title: 'A Night at the Opera',
  primaryType: 'Album',
  secondaryTypes: [],
  year: 1975,
  genres: ['rock'],
  coverArtUrl: null,
  artists: [ARTIST],
  ...overrides,
});

/** One track on an album, at its place on a disc. */
const trackOn = (
  id: string,
  title: string,
  disc: FakeAlbumDisc,
  trackPosition: number,
): FakeAlbumTrack => ({
  id,
  title,
  coverUrl: null,
  lengthMs: 180_000,
  disambiguation: '',
  video: false,
  isrcs: [],
  artists: [ARTIST],
  genres: [],
  releases: [],
  disc,
  trackPosition,
});

/** The track grid of the album page, the only grid with that heading. */
const tracksSection = (page: Page) =>
  page.locator('section[aria-labelledby="album-tracks-title"]');

/** The card links of the grid, in the order they are on the page. */
const cardHrefs = (page: Page) =>
  tracksSection(page)
    .locator('a[href*="/tracks/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href')));

/** Stops the infinite-scroll sentinel, so only the "Load more" button pages. */
const disableScrollPaging = (page: Page) =>
  page.addInitScript(() => {
    const RealObserver = window.IntersectionObserver;
    window.IntersectionObserver = class extends RealObserver {
      override observe(): void {}
    };
  });

for (const { locale, messages, tracksCount } of cases) {
  test.describe(`album tracks (${locale})`, () => {
    test('lists the tracks in album order, linking each card to its track', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `album-order-${locale}`;
      const disc = { position: 1, title: null };
      await setAlbumMock({
        albums: [albumFixture(id)],
        tracksByAlbum: {
          [id]: [
            trackOn(`order-c-${locale}`, 'Third', disc, 3),
            trackOn(`order-a-${locale}`, 'First', disc, 1),
            trackOn(`order-b-${locale}`, 'Second', disc, 2),
          ],
        },
      });

      await page.goto(`/${locale}/albums/${id}`);

      await expect(
        tracksSection(page).getByRole('link', { name: /Third/ }),
      ).toBeVisible();
      expect(await cardHrefs(page)).toEqual([
        `/${locale}/tracks/order-a-${locale}`,
        `/${locale}/tracks/order-b-${locale}`,
        `/${locale}/tracks/order-c-${locale}`,
      ]);
    });

    test('shows no disc heading when every track is on one disc', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `album-one-disc-${locale}`;
      const disc = { position: 1, title: null };
      await setAlbumMock({
        albums: [albumFixture(id)],
        tracksByAlbum: {
          [id]: [
            trackOn(`one-disc-a-${locale}`, 'Solo A', disc, 1),
            trackOn(`one-disc-b-${locale}`, 'Solo B', disc, 2),
          ],
        },
      });

      await page.goto(`/${locale}/albums/${id}`);

      await expect(
        tracksSection(page).getByRole('link', { name: /Solo B/ }),
      ).toBeVisible();
      await expect(
        tracksSection(page).getByRole('heading', { level: 3 }),
      ).toHaveCount(0);
    });

    test('heads a two-disc album with "Disc N" and "Disc N · Name"', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `album-two-discs-${locale}`;
      const first = { position: 1, title: null };
      const bonus = { position: 2, title: 'Bonus Disc' };
      await setAlbumMock({
        albums: [albumFixture(id)],
        tracksByAlbum: {
          [id]: [
            trackOn(`discs-1-${locale}`, 'Main One', first, 1),
            trackOn(`discs-2-${locale}`, 'Bonus One', bonus, 1),
          ],
        },
      });

      await page.goto(`/${locale}/albums/${id}`);

      const section = tracksSection(page);
      await expect(
        section.getByRole('heading', {
          level: 3,
          name: messages.albums.tracks.disc.numbered.replace('{number}', '1'),
        }),
      ).toBeVisible();
      await expect(
        section.getByRole('heading', {
          level: 3,
          name: messages.albums.tracks.disc.named
            .replace('{number}', '2')
            .replace('{title}', 'Bonus Disc'),
        }),
      ).toBeVisible();
    });

    test('keeps a disc heading to one per disc across "Load more"', async ({
      page,
    }) => {
      await mockAuthApi(page);
      await disableScrollPaging(page);
      const id = `album-paged-discs-${locale}`;
      const first = { position: 1, title: null };
      const bonus = { position: 2, title: 'Bonus Disc' };
      // Twenty-one tracks on disc 1 fill the first page with one disc, so no
      // heading shows until the second page brings disc 2 in.
      const tracks: FakeAlbumTrack[] = [];
      for (let index = 1; index <= 21; index += 1) {
        const padded = String(index).padStart(2, '0');
        tracks.push(
          trackOn(`paged-${locale}-${padded}`, `Paged ${padded}`, first, index),
        );
      }
      tracks.push(trackOn(`paged-bonus-${locale}`, 'Paged Bonus', bonus, 1));
      await setAlbumMock({
        albums: [albumFixture(id)],
        tracksByAlbum: { [id]: tracks },
      });

      await page.goto(`/${locale}/albums/${id}`);
      const section = tracksSection(page);
      await expect(
        section.getByRole('link', { name: /Paged 20/ }),
      ).toBeVisible();
      await expect(section.getByRole('heading', { level: 3 })).toHaveCount(0);

      await section
        .getByRole('button', { name: messages.albums.tracks.loadMore })
        .click();

      await expect(
        section.getByRole('link', { name: /Paged Bonus/ }),
      ).toBeVisible();
      await expect(
        section.getByRole('heading', {
          level: 3,
          name: messages.albums.tracks.disc.numbered.replace('{number}', '1'),
        }),
      ).toHaveCount(1);
      await expect(
        section.getByRole('heading', {
          level: 3,
          name: messages.albums.tracks.disc.named
            .replace('{number}', '2')
            .replace('{title}', 'Bonus Disc'),
        }),
      ).toHaveCount(1);
    });

    test('counts the album tracks in the header info line', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `album-count-${locale}`;
      const disc = { position: 1, title: null };
      await setAlbumMock({
        albums: [albumFixture(id)],
        tracksByAlbum: {
          [id]: [
            trackOn(`count-a-${locale}`, 'Count A', disc, 1),
            trackOn(`count-b-${locale}`, 'Count B', disc, 2),
            trackOn(`count-c-${locale}`, 'Count C', disc, 3),
          ],
        },
      });

      await page.goto(`/${locale}/albums/${id}`);

      const info = [
        messages.albums.types.primary.album,
        '1975',
        tracksCount(3),
      ].join(messages.albums.header.separator);
      await expect(
        page
          .locator('section[aria-labelledby="album-title"]')
          .getByText(info, { exact: true }),
      ).toBeVisible();
    });

    test('shows the empty state for an album with no tracks, header kept', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `album-no-tracks-${locale}`;
      await setAlbumMock({ albums: [albumFixture(id)] });

      await page.goto(`/${locale}/albums/${id}`);

      await expect(
        tracksSection(page).getByText(messages.albums.tracks.empty.title),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 1, name: 'A Night at the Opera' }),
      ).toBeVisible();
    });

    test('shows a retry state for failed tracks, header kept', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `album-tracks-down-${locale}`;
      await setAlbumMock({
        albums: [albumFixture(id)],
        tracksByAlbum: {
          [id]: [
            trackOn(
              `down-${locale}`,
              'Unreachable',
              { position: 1, title: null },
              1,
            ),
          ],
        },
        tracksErrorByAlbum: { [id]: { status: 500, code: 'INTERNAL_ERROR' } },
      });

      await page.goto(`/${locale}/albums/${id}`);

      // The query client retries 500s, so the error surfaces after ~7s.
      await expect(
        tracksSection(page).getByText(messages.albums.tracks.error.title),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        tracksSection(page).getByRole('button', {
          name: messages.albums.tracks.error.retry,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 1, name: 'A Night at the Opera' }),
      ).toBeVisible();
    });

    test('stays readable on small screens', async ({ page }) => {
      await mockAuthApi(page);
      await page.setViewportSize({ width: 360, height: 800 });
      const id = `album-tracks-small-${locale}`;
      const disc = { position: 1, title: null };
      await setAlbumMock({
        albums: [albumFixture(id)],
        tracksByAlbum: {
          [id]: [trackOn(`small-${locale}`, 'Small Screen Track', disc, 1)],
        },
      });

      await page.goto(`/${locale}/albums/${id}`);

      await expect(
        tracksSection(page).getByRole('link', { name: /Small Screen Track/ }),
      ).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  });
}
