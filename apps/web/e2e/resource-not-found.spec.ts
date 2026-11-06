import { expect, test } from '@playwright/test';

import { messages } from './messages';

for (const locale of ['en', 'pt-BR'] as const) {
  for (const collection of ['tracks', 'artists', 'albums', 'users']) {
    test(`${locale}: missing ${collection} uses the site not-found page`, async ({
      page,
    }) => {
      const path = `/${locale}/${collection}/missing-resource-ui`;
      const response = await page.goto(`${path}?from=shared`);
      const copy = messages[locale].notFound;

      expect(response?.status()).toBe(404);
      await expect(page).toHaveURL(`${path}?from=shared`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByRole('banner')).toHaveCount(1);
      await expect(
        page.getByRole('heading', { level: 1, name: `404 ${copy.title}` }),
      ).toBeVisible();
      await expect(page.getByText(copy.description)).toBeVisible();
      await expect(
        page.getByRole('link', { name: copy.homeLabel }),
      ).toHaveAttribute('href', `/${locale}`);
      await expect(
        page.getByRole('link', { name: copy.searchLabel }),
      ).toHaveAttribute('href', `/${locale}/search`);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex',
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
      await expect(page.locator('link[hreflang]')).toHaveCount(0);
    });
  }
}
