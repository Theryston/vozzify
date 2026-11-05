import { expect, test } from '@playwright/test';
import { mockAuthApi } from './auth-api-mock';
import { messages } from './messages';
import { mockSearchApi } from './search-api-mock';

test.describe.configure({ mode: 'serial' });

for (const locale of ['en', 'pt-BR'] as const) {
  test(`search invites note generation in ${locale}`, async ({ page }) => {
    const t = messages[locale];
    await mockAuthApi(page);
    await mockSearchApi(page, {
      totalCount: 2,
      unlinked: { title: 'Somebody to Love', artist: 'Queen', trackId: null },
    });
    await page.goto(`/${locale}/search?q=queen`);
    const card = page.getByRole('main').getByRole('link', {
      name: t.tracks.card.signInLabel.replace('{title}', 'Somebody to Love'),
    });
    await card.hover();
    await expect(
      card.getByText(t.tracks.card.generate, { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`search-${locale}.png`),
      fullPage: true,
    });
    await page.goto(`/${locale}`);
    await page.getByRole('banner').getByRole('combobox').fill('queen');
    const options = page.getByRole('listbox');
    await expect(
      options.getByText(t.header.search.suggestions.noNotesYet),
    ).toHaveText(t.tracks.card.generate);
    await page.screenshot({
      path: test.info().outputPath(`autocomplete-${locale}.png`),
      animations: 'disabled',
      clip: { x: 0, y: 0, width: 1280, height: 320 },
    });
  });
}
