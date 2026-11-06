import { expect, type Page, test } from '@playwright/test';
import { createTranslator } from 'next-intl';

import { ADA, mockAuthApi } from './auth-api-mock';
import {
  type FakeTrack,
  SIGNED_IN_COOKIE,
  setTrackMock,
} from './fake-track-api';
import { messages as catalogs } from './messages';

const cases = [
  { locale: 'en', messages: catalogs.en },
  { locale: 'pt-BR', messages: catalogs['pt-BR'] },
] as const;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const LABEL_VALUES = {
  title: 'Under Pressure',
  count: 3,
  low: 'C#3',
  high: 'G4',
} as const;

const VIEWPORTS = [
  { name: 'desktop', size: { width: 1280, height: 800 } },
  { name: 'phone', size: { width: 390, height: 844 } },
] as const;

const NOTES = [
  { pitch: 49, start: 0, end: 1.5 },
  { pitch: 64, start: 2, end: 3 },
  { pitch: 67, start: 3.5, end: 5 },
];

/** A completed Track with notes, unless the overrides say otherwise. */
const completedTrack = (
  id: string,
  overrides: Partial<FakeTrack> = {},
): FakeTrack => ({
  id,
  title: 'Under Pressure',
  artistCredit: [
    { name: 'Queen', joinPhrase: ' & ', artistId: 'artist-queen' },
    { name: 'David Bowie', joinPhrase: '' },
  ],
  durationMs: 248_000,
  processing: { status: 'COMPLETED' },
  notes: NOTES,
  contributors: [
    {
      id: `contributor-${id}`,
      username: 'ada_singer',
      name: 'Ada Lovelace',
      image: null,
    },
  ],
  ...overrides,
});

/** The first canvas pixel (RGBA) matching `isMatch`, or null. */
function findPixel(
  page: Page,
  predicate: 'orange' | 'corner',
): Promise<number[] | null> {
  return page.evaluate((mode) => {
    const canvas = document.querySelector('canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return null;
    const { width, height } = canvas;
    if (mode === 'corner') {
      return [...ctx.getImageData(width - 3, 3, 1, 1).data];
    }
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let index = 0; index < data.length; index += 4) {
      const [r = 0, g = 0, b = 0, a = 0] = data.slice(index, index + 4);
      if (a === 255 && r > 200 && g < 140 && b < 110) {
        return [r, g, b, a];
      }
    }
    return null;
  }, predicate);
}

for (const { locale, messages } of cases) {
  const practice = messages.tracks.practice;
  const t = createTranslator({
    locale,
    messages,
    namespace: 'tracks.practice',
  });

  test.describe(`track practice page (${locale})`, () => {
    test('keeps showing the Processing view while the latest Processing is not completed', async ({
      page,
    }) => {
      const trackId = `clx-practice-running-${locale}`;
      await setTrackMock({
        tracks: [
          completedTrack(trackId, {
            processing: { status: 'EXTRACTING_VOCALS' },
          }),
        ],
      });

      await page.goto(`/${locale}/tracks/${trackId}`);

      await expect(page.getByRole('progressbar')).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(0);
    });

    test('has localized metadata: title, notes in the description, Open Graph music.song and the canonical URL', async ({
      page,
    }) => {
      const trackId = `clx-practice-meta-${locale}`;
      await setTrackMock({
        tracks: [
          completedTrack(trackId, {
            coverUrl: 'https://coverartarchive.org/release/abc/front-500.jpg',
          }),
        ],
      });

      await page.goto(`/${locale}/tracks/${trackId}`);

      const meta = (selector: string) =>
        page.locator(selector).first().getAttribute('content');
      // The locale layout appends the site name to the page title.
      await expect
        .poll(() => page.title())
        .toMatch(
          new RegExp(
            `^${escapeRegExp(
              t('metaTitle', {
                title: 'Under Pressure',
                artists: 'Queen & David Bowie',
              }),
            )}( \\|.*)?$`,
          ),
        );
      expect(await meta('meta[name="description"]')).toBe(
        t('metaDescription', {
          title: 'Under Pressure',
          artists: 'Queen & David Bowie',
          low: 'C#3',
          high: 'G4',
        }),
      );
      expect(await meta('meta[property="og:type"]')).toBe('music.song');
      expect(await meta('meta[property="og:image"]')).toBe(
        'https://coverartarchive.org/release/abc/front-500.jpg',
      );
      expect(await meta('meta[property="music:duration"]')).toBe('248');
      expect(await meta('meta[property="music:musician"]')).toContain(
        `/${locale}/artists/artist-queen`,
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        'href',
        new RegExp(`/${locale}/tracks/${trackId}$`),
      );
    });

    test('keeps a toast showing when the page switches to the practice view', async ({
      page,
    }) => {
      await page
        .context()
        .addCookies([{ ...SIGNED_IN_COOKIE, domain: 'localhost', path: '/' }]);
      await mockAuthApi(page, { user: { ...ADA, username: 'ada_singer' } });
      const trackId = `clx-practice-toast-${locale}`;
      await setTrackMock({
        tracks: [
          completedTrack(trackId, {
            processing: {
              status: 'FAILED',
              failureCode: 'INTERNAL',
              retryable: true,
              resumeFrom: 'FINDING_VIDEO',
            },
          }),
        ],
      });
      await page.goto(`/${locale}/tracks/${trackId}`);
      // Someone else's retry completed the Processing: the retry is refused, and
      // the page moves on to the practice view while the toast is still up.
      await setTrackMock({ tracks: [completedTrack(trackId)] });

      await page
        .getByRole('button', { name: messages.tracks.processing.retry.action })
        .click();

      await expect(
        page.getByText(messages.tracks.processing.retry.conflict),
      ).toBeVisible();
      await expect(
        page.getByRole('img', { name: t('timeline.label', LABEL_VALUES) }),
      ).toBeVisible();
      await expect(
        page.getByText(messages.tracks.processing.retry.conflict),
      ).toBeVisible();
    });

    for (const { name, size } of VIEWPORTS) {
      test.describe(`on ${name}`, () => {
        test.use({ viewport: size });

        test('switches from the Processing view to the practice view without a reload', async ({
          page,
        }) => {
          await mockAuthApi(page, { user: { ...ADA, username: 'ada_singer' } });
          const trackId = `clx-practice-switch-${name}-${locale}`;
          await setTrackMock({
            tracks: [
              completedTrack(trackId, {
                processing: { status: 'DETECTING_NOTES' },
              }),
            ],
          });
          await page.goto(`/${locale}/tracks/${trackId}`);
          await expect(
            page.getByText(messages.tracks.processing.closeNote),
          ).toBeVisible();
          await page.evaluate(() => {
            (window as unknown as { stillHere: boolean }).stillHere = true;
          });

          await setTrackMock({ tracks: [completedTrack(trackId)] });

          await expect(
            page.getByRole('img', {
              name: t('timeline.label', LABEL_VALUES),
            }),
          ).toBeVisible({ timeout: 15_000 });
          await expect(page.getByRole('progressbar')).toHaveCount(0);
          expect(
            await page.evaluate(
              () => (window as unknown as { stillHere?: boolean }).stillHere,
            ),
          ).toBe(true);
        });

        test('shows the no-voice message instead of the timeline for a Track without notes', async ({
          page,
        }) => {
          const trackId = `clx-practice-instrumental-${name}-${locale}`;
          await setTrackMock({
            tracks: [completedTrack(trackId, { notes: [] })],
          });

          await page.goto(`/${locale}/tracks/${trackId}`);

          await expect(
            page.getByRole('heading', { name: practice.noVoice.title }),
          ).toBeVisible();
          await expect(
            page.getByText(practice.noVoice.description),
          ).toBeVisible();
          await expect(page.locator('canvas')).toHaveCount(0);
          await expect(
            page.getByRole('heading', { level: 1, name: 'Under Pressure' }),
          ).toBeVisible();
        });

        test('lays out the title row: cover, title, linked artists, duration and Contributors', async ({
          page,
        }) => {
          const trackId = `clx-practice-row-${name}-${locale}`;
          await setTrackMock({ tracks: [completedTrack(trackId)] });

          await page.goto(`/${locale}/tracks/${trackId}`);

          await expect(
            page.getByRole('heading', { level: 1, name: 'Under Pressure' }),
          ).toBeVisible();
          await expect(
            page.getByRole('link', { name: 'Queen' }),
          ).toHaveAttribute('href', `/${locale}/artists/artist-queen`);
          // An artist without a page in the catalog is plain text.
          await expect(
            page.getByText('Queen & David Bowie', { exact: true }),
          ).toBeVisible();
          await expect(
            page.getByRole('link', { name: 'David Bowie' }),
          ).toHaveCount(0);
          await expect(page.locator('time')).toHaveText('4:08');
          await page
            .getByRole('button', { name: t('contributorsOpen', { count: 1 }) })
            .click();
          await expect(
            page.getByRole('heading', {
              name: t('contributorsDialog.title'),
            }),
          ).toBeVisible();
          await expect(
            page.getByRole('link', {
              name: t('contributorLink', { name: 'Ada Lovelace' }),
            }),
          ).toHaveAttribute('href', `/${locale}/users/ada_singer`);
          const overflows = await page.evaluate(
            () =>
              document.documentElement.scrollWidth >
              document.documentElement.clientWidth,
          );
          expect(overflows).toBe(false);
        });

        test('draws the notes on the canvas, and redraws them when the theme changes', async ({
          page,
        }) => {
          const trackId = `clx-practice-canvas-${name}-${locale}`;
          await setTrackMock({ tracks: [completedTrack(trackId)] });
          await page.emulateMedia({ colorScheme: 'light' });
          await page.goto(`/${locale}/tracks/${trackId}`);
          const timeline = page.getByRole('img', {
            name: t('timeline.label', LABEL_VALUES),
          });
          await expect(timeline).toBeVisible();

          await expect.poll(() => findPixel(page, 'orange')).not.toBeNull();
          const light = await findPixel(page, 'corner');

          await page.emulateMedia({ colorScheme: 'dark' });

          await expect.poll(() => findPixel(page, 'corner')).not.toEqual(light);
          await expect.poll(() => findPixel(page, 'orange')).not.toBeNull();
        });
      });
    }
  });
}
