import { expect, test } from '@playwright/test';

for (const locale of ['en', 'pt-BR']) {
  test(`${locale}: initializes the Google Tag Manager container`, async ({
    page,
  }) => {
    const scripts: string[] = [];
    await page.route('https://www.googletagmanager.com/**', async (route) => {
      scripts.push(route.request().url());
      await route.fulfill({ contentType: 'application/javascript', body: '' });
    });

    await page.goto(`/${locale}/sign-in`);

    await expect(page.locator('script#_next-gtm')).toHaveAttribute(
      'src',
      'https://www.googletagmanager.com/gtm.js?id=GTM-PD2H3WNN',
    );
    await expect
      .poll(() => scripts)
      .toEqual(['https://www.googletagmanager.com/gtm.js?id=GTM-PD2H3WNN']);
    await expect
      .poll(() => page.evaluate(() => Reflect.get(window, 'dataLayer')))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'gtm.js',
            'gtm.start': expect.any(Number),
          }),
        ]),
      );
  });
}
