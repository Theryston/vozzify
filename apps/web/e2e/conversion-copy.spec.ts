import { expect, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import { ADA, mockAuthApi } from './auth-api-mock';
import { defaultPlanCatalog } from './fake-plans-api';
import { messages } from './messages';
import { mockSearchApi } from './search-api-mock';
import { webServerEnv } from './web-server-env';

test.describe.configure({ mode: 'serial' });

for (const locale of ['en', 'pt-BR'] as const) {
  test(`free trial promotion follows eligibility in ${locale}`, async ({
    page,
  }) => {
    const t = createTranslator({ locale, messages: messages[locale] });
    const catalog = defaultPlanCatalog(locale);
    const pro = catalog.plans.find((plan) => plan.id === 'pro');
    if (!pro) throw new Error('Expected Pro');
    pro.trialDays = 14;
    pro.saleAvailable = true;
    await fetch('http://127.0.0.1:3333/__plans-mock/set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale, catalog }),
    });
    await fetch('http://localhost:3000/api/revalidate', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${webServerEnv.REVALIDATE_SECRET}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tags: ['plans'] }),
    });
    await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
    let eligible = true;
    await page.route('**/v1/me/subscription/trial-eligibility', (route) =>
      route.fulfill({
        json: { eligible },
        headers: {
          'access-control-allow-origin': 'http://localhost:3000',
          'access-control-allow-credentials': 'true',
        },
      }),
    );
    await page.goto(`/${locale}/plans`);
    const card = page.getByRole('article', { name: 'Pro', exact: true });
    await expect(
      card.getByText(t('plans.trialBadge', { days: 14 }), { exact: true }),
    ).toBeVisible();
    await expect(
      card.getByRole('button', { name: t('plans.tryFree') }),
    ).toBeEnabled();
    await expect(card.getByTestId('plan-price')).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`plans-${locale}.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      card.getByRole('button', { name: t('plans.tryFree') }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath(`plans-mobile-${locale}.png`),
      fullPage: true,
      animations: 'disabled',
    });
    eligible = false;
    await page.reload();
    await expect(
      card.getByRole('button', {
        name: t('plans.choosePlan', { plan: 'Pro' }),
      }),
    ).toBeEnabled();
    await expect(
      card.getByText(t('plans.trialBadge', { days: 14 }), { exact: true }),
    ).toHaveCount(0);
    await expect(card.getByText(t('plans.trialUsed'))).toBeVisible();
    await fetch('http://127.0.0.1:3333/__plans-mock/set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale, catalog: defaultPlanCatalog(locale) }),
    });
  });

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
