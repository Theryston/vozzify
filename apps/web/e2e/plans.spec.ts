import { expect, test } from '@playwright/test';
import type { Locale, PlanCatalog } from '@vozzify/contracts';
import {
  registerAdminPlanJourneys,
  registerInvalidPlanPriceJourneys,
  registerPlanRetryJourney,
} from './admin-plans-journeys';
import { ADA, mockAuthApi } from './auth-api-mock';
import { defaultPlanCatalog } from './fake-plans-api';
import { messages } from './messages';
import { registerPlanCheckoutJourneys } from './plans-checkout-journeys';
import { registerPlanLayoutJourneys } from './plans-layout-journeys';
import { registerTrialPromotionJourneys } from './plans-trial-promotion-journeys';
import { webServerEnv } from './web-server-env';

test.describe.configure({ mode: 'serial' });

test('a delayed first comparison paints its natural mobile geometry without placeholder growth', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await mockAuthApi(page);
  await installCatalog('pt-BR', {
    catalog: defaultPlanCatalog('pt-BR'),
    delayMs: 300,
  });
  await page.addInitScript(() => {
    const frames: { placeholders: number; heights: number[] }[] = [];
    const record = () => {
      const main = document.querySelector('main');
      if (!main) return;
      const placeholders = main.querySelectorAll(
        '[data-slot="skeleton"]',
      ).length;
      const heights = Array.from(main.querySelectorAll('article'), (card) =>
        Math.round(card.getBoundingClientRect().height),
      );
      if (!placeholders && !heights.length) return;
      frames.push({ placeholders, heights });
      document.documentElement.dataset.planRenderFrames =
        JSON.stringify(frames);
    };
    const observer = new MutationObserver(() => requestAnimationFrame(record));
    observer.observe(document, { childList: true, subtree: true });
  });
  await page.goto('/pt-BR/plans');
  await expect(
    page.getByRole('article', { name: 'Pro', exact: true }),
  ).toBeVisible();
  const frames: { placeholders: number; heights: number[] }[] = JSON.parse(
    (await page.locator('html').getAttribute('data-plan-render-frames')) ??
      '[]',
  );
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.some((frame) => frame.placeholders > 0)).toBe(false);
  const painted = frames.filter((frame) => frame.heights.length === 2);
  expect(painted.length).toBeGreaterThan(0);
  expect(new Set(painted.map((frame) => frame.heights.join(','))).size).toBe(1);
  await installCatalog('pt-BR', { catalog: defaultPlanCatalog('pt-BR') });
});

test('a cold unavailable catalog shows a localized error and retries successfully', async ({
  page,
}) => {
  await mockAuthApi(page);
  await installCatalog('en', { status: 503 });
  await page.goto('/en/plans');
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    messages.en.plans.error,
  );
  await installCatalog('en', { catalog: defaultPlanCatalog('en') });
  await page
    .getByRole('link', { name: messages.en.plans.retry, exact: true })
    .click();
  await expect(
    page.getByRole('article', { name: 'Pro', exact: true }),
  ).toBeVisible();
});

for (const locale of ['en', 'pt-BR'] as const) {
  const t = messages[locale];
  test(`public plan comparison uses backend offers and discloses availability (${locale})`, async ({
    page,
  }) => {
    await mockAuthApi(page);
    await page.goto(`/${locale}/plans`);
    await expect(
      page.getByRole('heading', { level: 1, name: t.plans.title }),
    ).toBeVisible();
    const free = page.getByRole('article', {
      name: defaultPlanCatalog(locale).plans[0]?.name,
      exact: true,
    });
    await expect(free.getByText(t.plans.freePrice)).toBeVisible();
    await free.getByText(t.plans.includedBenefits, { exact: true }).click();
    await expect(free.getByRole('listitem')).toHaveCount(5);
    for (const benefit of defaultPlanCatalog(locale).plans[0]?.benefits ?? []) {
      await expect(free.getByText(benefit.name, { exact: true })).toBeVisible();
      await expect(
        free.getByRole('listitem').filter({ hasText: benefit.name }),
      ).toHaveAttribute('title', benefit.description);
    }
    await expect(
      free.getByRole('link', { name: t.plans.startSinging }),
    ).toHaveAttribute('href', `/${locale}/search`);
    const pro = page.getByRole('article', { name: 'Pro', exact: true });
    await expect(
      pro.getByText(t.plans.comingSoon, { exact: true }),
    ).toHaveCount(1);
    await expect(pro.getByRole('listitem')).toHaveCount(7);
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: locale === 'en' ? 'USD' : 'BRL',
    });
    const monthly = formatter.format(locale === 'en' ? 3.5 : 19.9);
    const annual = formatter.format(locale === 'en' ? 35 : 199);
    await expect(
      pro
        .getByTestId('plan-price')
        .getByText(t.plans.monthlyCharge.replace('{amount}', monthly), {
          exact: true,
        }),
    ).toBeVisible();
    await pro.getByRole('radio', { name: new RegExp(t.plans.annual) }).check();
    await expect(
      pro
        .getByTestId('plan-price')
        .getByText(t.plans.annualCharge.replace('{amount}', annual), {
          exact: true,
        }),
    ).toBeVisible();
    await expect(pro.getByText(t.plans.checkoutPending)).toBeVisible();
    await expect(pro.getByRole('link')).toHaveCount(0);
    await expect(
      pro.getByRole('button', {
        name: t.plans.choosePlan.replace('{plan}', 'Pro'),
      }),
    ).toHaveCount(0);
  });

  test(`signed-in Users reach plans through the account menu (${locale})`, async ({
    page,
  }) => {
    await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
    await page.route('**/v1/me/subscription?*', (route) =>
      route.fulfill({ json: { subscription: null } }),
    );
    await page.goto(`/${locale}/terms`);
    await page
      .getByRole('button', { name: t.header.account.accountMenu })
      .click();
    await page
      .getByRole('menuitem', { name: t.header.account.plans, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/plans$`));
    await expect(
      page.getByRole('article', { name: 'Pro', exact: true }),
    ).toBeVisible();
  });
}

for (const locale of ['en', 'pt-BR'] as const) {
  test(`phone comparison and account drawer work in dark mode (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
    await page.route('**/v1/me/subscription?*', (route) =>
      route.fulfill({ json: { subscription: null } }),
    );
    await page.goto(`/${locale}/terms`);
    const t = messages[locale];
    await page
      .getByRole('button', { name: t.header.account.accountMenu })
      .click();
    await page
      .getByRole('link', { name: t.header.account.plans, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/plans$`));
    const pro = page.getByRole('article', { name: 'Pro', exact: true });
    await expect(
      pro.getByText(t.plans.comingSoon, { exact: true }),
    ).toHaveCount(1);
    await expect(pro.getByRole('listitem')).toHaveCount(7);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
}

async function installCatalog(
  locale: Locale,
  reply: { catalog?: PlanCatalog; status?: number; delayMs?: number },
) {
  const result = await fetch('http://127.0.0.1:3333/__plans-mock/set', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ locale, ...reply }),
  });
  expect(result.ok).toBe(true);
  const invalidated = await fetch('http://localhost:3000/api/revalidate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${webServerEnv.REVALIDATE_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tags: ['plans'] }),
  });
  expect(invalidated.ok).toBe(true);
}

test('catalog updates retain configured cycles, omit undisclosed benefits, and show empty states', async ({
  page,
}) => {
  await mockAuthApi(page);
  const catalog = defaultPlanCatalog('en');
  const paid = catalog.plans.find((plan) => plan.id === 'pro');
  if (!paid) throw new Error('The fixture needs a paid plan');
  paid.name = 'Studio';
  paid.offers = [{ id: 'annual-studio', cycle: 'annual', amount: 4800 }];
  paid.benefits = paid.benefits.filter((benefit) => benefit.id !== 'ad-free');
  await installCatalog('en', { catalog });
  await expect(async () => {
    await page.goto('/en/plans');
    await expect(
      page.getByRole('article', { name: 'Studio', exact: true }),
    ).toBeVisible();
  }).toPass();
  const studio = page.getByRole('article', { name: 'Studio', exact: true });
  await expect(
    studio
      .getByTestId('plan-price')
      .getByText('$48.00 billed annually', { exact: true }),
  ).toBeVisible();
  await expect(studio.getByText(/billed monthly/)).toHaveCount(0);
  await expect(
    studio.getByText('Ad-free experience', { exact: true }),
  ).toHaveCount(0);
  paid.offers = [];
  await installCatalog('en', { catalog });
  await expect(async () => {
    await page.reload();
    await expect(studio.getByText(messages.en.plans.noOffers)).toBeVisible();
  }).toPass();
  await installCatalog('en', { catalog: { currency: 'USD', plans: [] } });
  await expect(async () => {
    await page.reload();
    await expect(page.getByText(messages.en.plans.empty)).toBeVisible();
  }).toPass();
  await installCatalog('en', { catalog: defaultPlanCatalog('en') });
});

registerAdminPlanJourneys();
registerPlanRetryJourney();
registerInvalidPlanPriceJourneys();
registerPlanCheckoutJourneys(installCatalog);

registerPlanLayoutJourneys(installCatalog);

registerTrialPromotionJourneys(installCatalog);
