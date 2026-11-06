import { expect, test } from '@playwright/test';

for (const locale of ['en', 'pt-BR']) {
  test(`${locale}: does not load Google Tag Manager in the e2e build`, async ({
    page,
  }) => {
    const scripts: string[] = [];
    await page.route('https://www.googletagmanager.com/**', async (route) => {
      scripts.push(route.request().url());
      await route.fulfill({ contentType: 'application/javascript', body: '' });
    });

    const response = await page.goto(`/${locale}/sign-in`, {
      waitUntil: 'networkidle',
    });

    expect(response?.ok()).toBe(true);
    await expect(page.locator('script#_next-gtm')).toHaveCount(0);
    await expect(page.locator('script#_next-gtm-init')).toHaveCount(0);
    expect(await page.evaluate(() => Reflect.get(window, 'dataLayer'))).toBe(
      undefined,
    );
    expect(scripts).toEqual([]);
  });
}
