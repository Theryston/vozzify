import { expect, type Page, test } from '@playwright/test';
import type { Locale, PlanCatalog } from '@vozzify/contracts';
import { createTranslator } from 'next-intl';
import { ADA, mockAuthApi } from './auth-api-mock';
import { defaultPlanCatalog } from './fake-plans-api';
import { messages } from './messages';

type InstallCatalog = (
  locale: Locale,
  reply: { catalog?: PlanCatalog },
) => Promise<void>;

// Register with the shared serial suite so the cold-cache scenario runs first.
export function registerTrialPromotionJourneys(install: InstallCatalog) {
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
      await install(locale, { catalog });
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
      const card = page.getByRole('article', { name: 'Pro', exact: true });
      await expect(async () => {
        await page.goto(`/${locale}/plans`);
        await expect(
          card.getByText(t('plans.trialBadge', { days: 14 }), { exact: true }),
        ).toBeVisible();
      }).toPass();
      await expect(
        card.getByRole('button', { name: t('plans.tryFree') }),
      ).toBeEnabled();
      await expect(card.getByTestId('plan-price')).toBeVisible();
      await captureTrialLayouts(page, locale);
      await expect(
        card.getByRole('button', { name: t('plans.tryFree') }),
      ).toBeVisible();
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
      await install(locale, { catalog: defaultPlanCatalog(locale) });
    });
  }
}

async function captureTrialLayouts(page: Page, locale: Locale) {
  await page.screenshot({
    path: test.info().outputPath(`plans-${locale}.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: test.info().outputPath(`plans-mobile-${locale}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}
