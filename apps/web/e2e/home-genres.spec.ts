import { expect, test } from '@playwright/test';
import type { FakeHomeRow } from './fake-home-api';
import {
  circularHero,
  circularTrack,
  installHomeMock,
  restoreHomeMocks,
} from './home-circular-fixtures';
import { messages } from './messages';
import { webServerEnv } from './web-server-env';

test.describe.configure({ mode: 'serial' });
test.afterAll(restoreHomeMocks);

for (const locale of ['en', 'pt-BR'] as const) {
  test(`renders localized genre cards with both paging axes in ${locale}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning')
        errors.push(message.text());
    });
    await page.setViewportSize(
      locale === 'en'
        ? { width: 1280, height: 800 }
        : { width: 390, height: 844 },
    );
    await page.emulateMedia({
      colorScheme: locale === 'en' ? 'light' : 'dark',
      reducedMotion: 'reduce',
    });
    const prefix = `genre-${locale}-${Date.now()}`;
    const genreId = `${prefix}-pop`;
    const items = Array.from({ length: 25 }, (_, index) => ({
      ...circularTrack(
        `${prefix}-${index}`,
        `Genre Track ${index}`,
        `Artist ${index % 6}`,
      ),
      coverUrl:
        'https://coverartarchive.org/release-group/00000000-0000-4000-8000-00000000a001/front-500',
    }));
    const rows: FakeHomeRow[] = [
      circularHero(`${prefix}-hero`, 'Genre fixture lead'),
      ...Array.from({ length: 5 }, (_, index) => ({
        id: `${prefix}-existing-${index}`,
        layout: 'standard',
        title: { key: 'home.rows.newTracks', params: {} },
        items: [circularTrack(`${prefix}-earlier-${index}`, 'Earlier Track')],
      })),
      {
        id: genreId,
        layout: 'standard',
        title: { key: 'home.rows.popularGenre', params: { genre: 'pop' } },
        items,
      },
    ];
    await installHomeMock({ feeds: { en: rows, 'pt-BR': rows } });
    await page.request.post('/api/revalidate', {
      headers: { authorization: `Bearer ${webServerEnv.REVALIDATE_SECRET}` },
      data: { tags: [`home:${locale}`] },
    });
    await expect
      .poll(async () => (await page.request.get(`/${locale}`)).text())
      .toContain(`${prefix}-hero`);
    await page.goto(`/${locale}`);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const row = page.locator(`[data-home-row-id="${genreId}"]`);
    await expect(
      row.getByRole('heading', {
        name: locale === 'en' ? 'Popular in pop' : 'Popular em pop',
      }),
    ).toBeVisible();
    const list = row.locator('ul');
    for (const index of [23, 24]) {
      await list.evaluate((element) =>
        element.scrollTo({ left: element.scrollWidth }),
      );
      await expect(
        row.locator(`[data-home-item-id="${prefix}-${index}"]`).first(),
      ).toBeAttached();
    }
    const logicalItems = row.locator(
      '[data-home-item-id]:not([aria-hidden="true"])',
    );
    await expect(logicalItems).toHaveCount(25);
    const first = logicalItems.first();
    await expect(first).toHaveAttribute('data-home-item-position', '0');
    await expect(first.locator('a').first()).toHaveAttribute(
      'href',
      new RegExp(`/${locale}/tracks/${prefix}-0`),
    );
    await expect(first).toContainText('A2');
    await expect(
      row.getByText(messages[locale].home.sponsored.row),
    ).toHaveCount(0);
    const cover = first.locator('img');
    await expect(cover).toHaveAttribute('src', /coverartarchive/);
    expect(errors).toEqual([]);
  });
}
