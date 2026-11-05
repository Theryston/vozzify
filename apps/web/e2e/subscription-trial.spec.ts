import { expect, test } from '@playwright/test';
import { createTranslator } from 'next-intl';
import { adminUser } from './admin-users';
import { ADA, mockAuthApi } from './auth-api-mock';
import { defaultPlanCatalog } from './fake-plans-api';
import { messages } from './messages';
import { webServerEnv } from './web-server-env';

const cors = {
  'access-control-allow-origin': 'http://localhost:3000',
  'access-control-allow-credentials': 'true',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

for (const locale of ['en', 'pt-BR'] as const) {
  test(`trial disclosure and private summary in ${locale}`, async ({
    page,
  }) => {
    const translate = createTranslator({ locale, messages: messages[locale] });
    const catalog = defaultPlanCatalog(locale);
    const pro = catalog.plans.find((plan) => plan.id === 'pro');
    if (!pro) throw new Error('Expected paid plan');
    pro.trialDays = 14;
    pro.saleAvailable = true;
    const response = await fetch('http://127.0.0.1:3333/__plans-mock/set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale, catalog }),
    });
    expect(response.ok).toBe(true);
    await fetch('http://localhost:3000/api/revalidate', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${webServerEnv.REVALIDATE_SECRET}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ tags: ['plans'] }),
    });
    await mockAuthApi(page, { user: { ...ADA, username: 'ada' } });
    await page.route('**/v1/me/subscription/trial-eligibility', (route) =>
      route.fulfill({ json: { eligible: true }, headers: cors }),
    );
    await page.route('**/v1/me/subscription/checkout', (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ status: 204, headers: cors });
      expect(route.request().postDataJSON()).toMatchObject({ trialDays: 14 });
      return route.fulfill({ json: { action: 'manage' }, headers: cors });
    });
    let canceled = false;
    await page.route('**/v1/me/subscription?*', (route) =>
      route.fulfill({
        headers: cors,
        json: {
          subscription: {
            planId: 'pro',
            planName: 'Pro',
            cycle: 'monthly',
            currency: 'USD',
            amount: 350,
            status: 'confirmed',
            providerStatus: 'trialing',
            paidMembership: true,
            currentPeriodStart: '2026-10-28T12:00:00.000Z',
            currentPeriodEnd: '2026-11-11T12:00:00.000Z',
            cancelAtPeriodEnd: canceled,
          },
        },
      }),
    );
    await expect(async () => {
      await page.goto(`/${locale}/plans`);
      await expect(
        page.getByText(translate('plans.trialOffer', { days: 14 }), {
          exact: true,
        }),
      ).toBeVisible();
    }).toPass();
    await expect(
      page.getByText(
        messages[locale].plans.trialFirstCharge.split('{date}')[0] ?? '',
      ),
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: translate('plans.tryFree'),
      })
      .click();
    await expect(page).toHaveURL(new RegExp(`/${locale}/subscription`));
    await expect(
      page.getByText(translate('billing.trialStatus'), { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(translate('billing.trialDescription'), { exact: true }),
    ).toBeVisible();
    canceled = true;
    await page.reload();
    await expect(
      page.getByText(translate('billing.trialEndingDescription'), {
        exact: true,
      }),
    ).toBeVisible();
    await fetch('http://127.0.0.1:3333/__plans-mock/set', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ locale, catalog: defaultPlanCatalog(locale) }),
    });
  });
}

for (const locale of ['en', 'pt-BR'] as const) {
  test(`admin configures trial days in ${locale}`, async ({ page }) => {
    await mockAuthApi(page, { user: adminUser });
    const t = messages[locale].adminPlans;
    const plan = {
      id: 'pro',
      kind: 'paid',
      copy: {
        en: { name: 'Pro', description: 'Support.' },
        'pt-BR': { name: 'Pro', description: 'Support.' },
      },
      displayOrder: 0,
      trialDays: 0,
      published: false,
      saleEnabled: false,
      enabledCycles: [],
      prices: [],
      syncStatus: 'synced',
      pendingOperation: null,
    };
    let saved = false;
    await page.route('**/v1/admin/plans**', async (route) => {
      if (route.request().method() === 'OPTIONS')
        return route.fulfill({ status: 204, headers: cors });
      if (route.request().method() === 'GET')
        return route.fulfill({
          json: { contractingEnabled: false, plans: [plan] },
          headers: cors,
        });
      const input = route.request().postDataJSON();
      expect(input.trialDays).toBe(14);
      saved = true;
      return route.fulfill({ json: { ...plan, ...input }, headers: cors });
    });
    await page.goto(`/${locale}/admin/plans`);
    await page
      .getByRole('button', { name: t.edit.replace('{name}', 'Pro') })
      .click();
    await page.locator('#trial-days').fill('14');
    await page.getByRole('button', { name: t.save, exact: true }).click();
    await expect.poll(() => saved).toBe(true);
  });
}
