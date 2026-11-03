import { expect, test } from '@playwright/test';

import { mockAuthApi } from './auth-api-mock';
import { messages } from './messages';
import { mockSearchApi } from './search-api-mock';

for (const locale of ['en', 'pt-BR'] as const) {
  for (const width of [320, 390]) {
    test.describe(`mobile header (${locale}, ${width}px)`, () => {
      test.use({
        viewport: { width, height: 844 },
        hasTouch: true,
        isMobile: true,
      });

      const { header } = messages[locale];

      test.beforeEach(async ({ page }) => {
        await mockAuthApi(page);
        await mockSearchApi(page);
        await page.goto(`/${locale}`);
        await expect(
          page.getByRole('banner').getByRole('link', {
            name: header.account.signIn,
          }),
        ).toBeVisible();
      });

      test('shows the wordmark and a larger symbol without overflow', async ({
        page,
      }, testInfo) => {
        const banner = page.getByRole('banner');
        const brand = banner.getByRole('link', { name: header.home });
        await expect(brand.getByText(header.wordmark)).toBeVisible();
        await expect(brand.locator('svg')).toHaveCSS('width', '28px');
        await expect(brand.locator('svg')).toHaveCSS('height', '28px');
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath('mobile-brand.png'),
        });
        await banner.screenshot({
          path: testInfo.outputPath('larger-logo.png'),
        });
      });

      test('restores the normal header after the search loses focus', async ({
        page,
      }, testInfo) => {
        const banner = page.getByRole('banner');
        const field = banner.getByRole('combobox');
        const open = banner.getByRole('button', { name: header.search.open });
        await open.tap();
        await expect(field).toBeFocused();
        await field.fill('queen');
        await expect(page.getByRole('listbox')).toBeVisible();
        await page.screenshot({
          path: testInfo.outputPath('search-focused.png'),
        });

        await page.locator('main').tap({ position: { x: 10, y: 10 } });
        await expect(field).toBeHidden();
        await expect(page.getByRole('listbox')).toHaveCount(0);
        await expect(open).toBeVisible();
        await expect(banner.getByText(header.wordmark)).toBeVisible();
        await expect(page).toHaveURL(`/${locale}`);
        await page.screenshot({
          path: testInfo.outputPath('search-blurred.png'),
        });

        await open.tap();
        await expect(field).toBeFocused();
        await expect(field).toHaveValue('queen');
        await field.fill('');
        await field.blur();
        await expect(field).toBeHidden();
      });

      test('keeps the field visible on the search page after blur', async ({
        page,
      }, testInfo) => {
        await page.goto(`/${locale}/search?q=queen`);
        const field = page.getByRole('banner').getByRole('combobox');
        await field.focus();
        await expect(field).toBeFocused();
        await field.blur();
        await expect(field).toBeVisible();
        await expect(field).not.toBeFocused();
        await expect(field).toHaveValue('queen');
        await page.screenshot({
          path: testInfo.outputPath('search-page-blurred.png'),
        });
      });
    });
  }
}
