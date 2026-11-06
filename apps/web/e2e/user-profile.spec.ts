import { expect, test } from '@playwright/test';

import { messages } from './messages';

// The Profile page against the fake API (`fake-user-profile.ts`): the banner
// of a known Profile, the real 404 for an unknown one, the permanent redirect
// of a mixed-case username, and the small-screen and theme smoke checks.
test.describe('public profile page', () => {
  test('renders the banner of a known Profile', async ({ page }) => {
    await page.goto('/en/users/ada_lovelace');

    const banner = page.getByRole('region', { name: 'Ada Lovelace' });
    await expect(banner).toBeVisible();
    await expect(banner.getByText('@ada_lovelace')).toBeVisible();
    await expect(page.getByText(/Member since January 2026/)).toBeVisible();
  });

  test('renders the banner in pt-BR', async ({ page }) => {
    await page.goto('/pt-BR/users/ada_lovelace');

    page.getByRole('region', { name: 'Ada Lovelace' });
    await expect(page.getByText(/Membro desde janeiro/)).toBeVisible();
  });

  test('answers an unknown username with a real 404', async ({ page }) => {
    const response = await page.goto('/en/users/nobody');

    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole('heading', { name: `404 ${messages.en.notFound.title}` }),
    ).toBeVisible();
  });

  test('stays up with a notice when the API fails', async ({ page }) => {
    const response = await page.goto('/en/users/broken');

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'Profile unavailable' }),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('redirects a mixed-case username with 308, keeping the query', async ({
    request,
    baseURL,
  }) => {
    const response = await request.get('/en/users/Ada_Lovelace?x=1', {
      maxRedirects: 0,
    });

    expect(response.status()).toBe(308);
    const location = new URL(response.headers().location ?? '', baseURL);
    expect(location.pathname).toBe('/en/users/ada_lovelace');
    expect(location.searchParams.get('x')).toBe('1');
  });

  test('fits a 360px screen without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/en/users/ada_lovelace');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Ada Lovelace' }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBe(0);
  });

  for (const colorScheme of ['light', 'dark'] as const) {
    test(`renders the banner in the ${colorScheme} theme`, async ({ page }) => {
      await page.emulateMedia({ colorScheme });
      await page.goto('/en/users/ada_lovelace');

      await expect(
        page.getByRole('region', { name: 'Ada Lovelace' }),
      ).toBeVisible();
    });
  }
});
