import { expect, test } from '@playwright/test';
import { createTranslator } from 'next-intl';

import { mockAuthApi } from './auth-api-mock';
import { defaultAlbum, setAlbumMock } from './fake-album-api-server';
import { defaultArtist, setArtistMock } from './fake-artist-api-server';
import { setTrackMock } from './fake-track-api';
import { messages as catalogs } from './messages';

for (const locale of ['en', 'pt-BR'] as const) {
  const messages = catalogs[locale];
  const t = createTranslator({ locale, messages });

  test.describe(`SEO content and previews (${locale})`, () => {
    test('home has a stable introduction and its own sharing metadata', async ({
      page,
    }) => {
      await mockAuthApi(page);
      await page.goto(`/${locale}`);

      await expect(
        page.getByRole('heading', { level: 1, name: t('homeSeo.title') }),
      ).toBeVisible();
      await expect(page.getByText(t('homeSeo.description'))).toBeVisible();
      const website = JSON.parse(
        (await page
          .locator('script[type="application/ld+json"]')
          .textContent()) ?? '{}',
      );
      expect(website).toMatchObject({ '@type': 'WebSite', name: 'Vozzify' });
      expect(website.url).toBe('http://localhost:3000/');
      const preview = await page.request.get('/social-card.png');
      expect(preview.ok()).toBe(true);
      expect(preview.headers()['content-type']).toContain('image/png');
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        'content',
        t('metadata.title'),
      );
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        'content',
        new RegExp(`/${locale}$`),
      );
      await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute(
        'content',
        /\/social-card\.png$/,
      );
    });

    test('artist describes its songs in metadata and structured data', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `seo-artist-${locale}`;
      await setArtistMock({ artists: [{ ...defaultArtist, id }] });

      await page.goto(`/${locale}/artists/${id}`);

      const title = t('artists.metaTitle', { name: 'Queen' });
      const description = t('artists.metaDescription', { name: 'Queen' });
      await expect(page).toHaveTitle(
        t('metadata.titleTemplate').replace('%s', title),
      );
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        'content',
        description,
      );
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        'content',
        title,
      );
      await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
        'content',
        title,
      );
      const data = JSON.parse(
        (await page
          .locator('script[type="application/ld+json"]')
          .textContent()) ?? '{}',
      );
      expect(data).toMatchObject({
        '@type': 'CollectionPage',
        name: 'Queen',
        inLanguage: locale,
        about: { '@type': 'Thing', name: 'Queen' },
      });
      expect(data.url).toMatch(new RegExp(`/${locale}/artists/${id}$`));
    });

    test('album includes its artist and safely serializes catalog names', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `seo-album-${locale}`;
      const title = 'Opera </script><script>window.seoInjected=true</script>';
      await setAlbumMock({ albums: [{ ...defaultAlbum, id, title }] });

      await page.goto(`/${locale}/albums/${id}`);

      const values = { title, artists: 'Queen' };
      const metaTitle = t('albums.metaTitle', values);
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        'content',
        metaTitle,
      );
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        'content',
        t('albums.metaDescription', values),
      );
      const data = JSON.parse(
        (await page
          .locator('script[type="application/ld+json"]')
          .textContent()) ?? '{}',
      );
      expect(data).toMatchObject({
        '@type': 'MusicAlbum',
        name: title,
        byArtist: [{ name: 'Queen' }],
      });
      expect(await page.evaluate(() => 'seoInjected' in window)).toBe(false);
    });

    test('album without credits has useful metadata without a dangling artist', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `seo-album-no-artists-${locale}`;
      await setAlbumMock({
        albums: [{ ...defaultAlbum, id, artists: [] }],
      });

      await page.goto(`/${locale}/albums/${id}`);

      const values = { title: defaultAlbum.title };
      await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
        'content',
        t('albums.metaTitleNoArtists', values),
      );
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        'content',
        t('albums.metaDescriptionNoArtists', values),
      );
    });

    test('completed song exposes its range and recording metadata', async ({
      page,
    }) => {
      await mockAuthApi(page);
      const id = `seo-track-${locale}`;
      await setTrackMock({
        tracks: [
          {
            id,
            title: 'Under Pressure',
            artistCredit: [
              { name: 'Queen', joinPhrase: '', artistId: defaultArtist.id },
            ],
            durationMs: 248_400,
            processing: { status: 'COMPLETED' },
            notes: [
              { pitch: 49, start: 0, end: 1 },
              { pitch: 67, start: 1, end: 2 },
            ],
          },
        ],
      });

      await page.goto(`/${locale}/tracks/${id}`);

      await expect(
        page.getByText(
          t('tracks.practice.noteSummary.range', {
            low: 'C#3',
            high: 'G4',
          }),
        ),
      ).toBeVisible();
      await expect(page.locator('meta[name="description"]')).toHaveAttribute(
        'content',
        t('tracks.practice.metaDescription', {
          title: 'Under Pressure',
          artists: 'Queen',
          low: 'C#3',
          high: 'G4',
        }),
      );
      const data = JSON.parse(
        (await page
          .locator('script[type="application/ld+json"]')
          .textContent()) ?? '{}',
      );
      expect(data).toMatchObject({
        '@type': 'MusicRecording',
        name: 'Under Pressure',
        duration: 'PT248.4S',
      });
    });
  });
}
